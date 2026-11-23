const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(['queued', 'running', 'interrupted', 'failed', 'complete']);
const ACTIVE = new Set(['queued', 'running']);
const PREFIX = 'bandlark:grading-jobs:v1:';
const VISITOR_KEY = 'essaypilot_visitor_id_v1';

export function cleanGradingJob(raw) {
  if (!raw || !UUID.test(raw.id || '') || !UUID.test(raw.request_id || '')
      || !['first', 'second'].includes(raw.kind) || !STATES.has(raw.state)
      || raw.report_id != null && !UUID.test(raw.report_id)
      || raw.parent_run_id != null && !UUID.test(raw.parent_run_id)
      || raw.kind === 'second' && !UUID.test(raw.parent_run_id || '')
      || raw.state === 'complete' && !UUID.test(raw.report_id || '')) return null;
  return {id: raw.id, request_id: raw.request_id, kind: raw.kind, state: raw.state,
    phase: typeof raw.phase === 'string' ? raw.phase : '', report_id: raw.report_id || null,
    parent_run_id: raw.parent_run_id || null, retryable: raw.retryable === true,
    message: typeof raw.message === 'string' ? raw.message.slice(0, 500) : ''};
}

export async function gradingFingerprint(input, cryptoImpl = globalThis.crypto) {
  const canonical = JSON.stringify([input.task_type || 'Task 2', input.parent_run_id || '',
    input.parent_run_id ? '' : String(input.topic || ''), String(input.essay || '')]);
  const bytes = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

// This record contains identifiers and a content digest only. The server owns
// the submitted text, execution state and billing outcome.
export function createGradingClient({fetchImpl = globalThis.fetch, storage = null,
  cryptoImpl = globalThis.crypto, onChange = () => {}, onComplete = () => {},
  local = false, accountWorkspace = false, pollMs = 1800, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  let userId = '', token = '', generation = 0, disposed = false, timer = null;
  let jobs = [], references = [], connection = 'idle', message = '', submitting = false;
  let activeRequest = '', submitPromise = null, loadPromise = null;
  let mutation = 0;
  const pending = new Set();
  const available = () => local === true || Boolean(userId && token);
  const key = () => local === true ? `${PREFIX}local-workspace` : `${PREFIX}${encodeURIComponent(userId)}`;
  const snapshot = () => ({userId, jobs: jobs.map(job => ({...job})), connection, message,
    submitting, activeRequest, uncertain: references.some(ref => !ref.confirmed && !jobs.some(job => job.request_id === ref.request_id))});
  const emit = () => { if (!disposed) onChange(snapshot()); };
  function save() {
    if (!available()) return;
    try { storage?.setItem(key(), JSON.stringify(references.slice(-20))); } catch { /* Server list also supports recovery. */ }
  }
  function read() {
    try {
      const raw = JSON.parse(storage?.getItem(key()) || '[]');
      references = Array.isArray(raw) ? raw.filter(ref => UUID.test(ref?.request_id || '')
        && /^[0-9a-f]{64}$/.test(ref.fingerprint || '')).slice(-20).map(ref => ({
          request_id: ref.request_id, fingerprint: ref.fingerprint,
          kind: ref.kind === 'second' ? 'second' : 'first',
          parent_run_id: UUID.test(ref.parent_run_id || '') ? ref.parent_run_id : null,
          confirmed: ref.confirmed === true,
        })) : [];
    } catch { references = []; }
  }
  function visitorId() {
    try {
      const old = storage?.getItem(VISITOR_KEY);
      if (UUID.test(old || '')) return old;
      const id = cryptoImpl?.randomUUID?.();
      if (!UUID.test(id || '')) return '';
      storage?.setItem(VISITOR_KEY, id);
      return storage?.getItem(VISITOR_KEY) === id ? id : '';
    } catch { return ''; }
  }
  const valid = stamp => !disposed && stamp === generation && available();
  function stopPoll() { if (timer !== null) clearTimer(timer); timer = null; }
  function schedule() {
    stopPoll();
    if (disposed || !available() || connection !== 'online' || !jobs.some(job => ACTIVE.has(job.state))) return;
    timer = setTimer(() => { timer = null; void load(); }, pollMs);
  }
  function accept(job, stamp) {
    if (!valid(stamp)) return;
    const prior = jobs.find(item => item.id === job.id);
    jobs = [job, ...jobs.filter(item => item.id !== job.id)].slice(0, 10);
    confirmReferences();
    if (job.state === 'complete' && prior?.state !== 'complete' && job.request_id === activeRequest)
      onComplete({...job});
  }
  function confirmReferences() {
    for (const ref of references) if (jobs.some(job => job.request_id === ref.request_id)) ref.confirmed = true;
    save();
  }
  async function request(path, options, stamp) {
    const controller = new AbortController(); pending.add(controller);
    try {
      const response = await fetchImpl(`/api/v1/grading-jobs${path}`, {
        ...options, cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: {...(local === true ? {} : {Authorization: `Bearer ${token}`}), ...options?.headers},
      });
      if (!valid(stamp)) return null;
      const body = await response.json().catch(() => ({}));
      if (!valid(stamp)) return null;
      if (!response.ok) {
        connection = response.status === 401 ? 'expired' : 'online';
        const detail = typeof body.message === 'string' ? body.message
          : typeof body.error?.message === 'string' ? body.error.message : '';
        message = detail || (response.status === 401 ? '登录已过期，请重新登录后读取任务。'
          : response.status === 409 ? '这次提交与已有任务不一致，请先读取已有任务。'
            : response.status === 403 ? '当前账号无法开始这次批改，请确认登录状态。'
              : '暂时无法处理这次请求，请稍后重试。');
        throw Object.assign(new Error('request_rejected'), {handled: true, status: response.status});
      }
      connection = 'online'; message = '';
      return body;
    } finally { pending.delete(controller); }
  }
  function failed(error, stamp) {
    if (!valid(stamp)) return;
    if (!error.handled) {
      connection = 'offline';
      message = '连接中断，尚未确认任务状态。请重新读取，已提交的任务会继续处理。';
    }
    emit(); stopPoll();
  }
  function load() {
    if (disposed || !available()) return Promise.resolve(null);
    if (loadPromise) return loadPromise;
    const stamp = generation;
    const revision = mutation;
    const promise = (async () => {
      try {
        const body = await request('', {method: 'GET'}, stamp);
        if (!body || !valid(stamp)) return null;
        if (revision !== mutation) { schedule(); return snapshot(); }
        if (!Array.isArray(body.jobs)) throw new Error('invalid_jobs');
        const clean = body.jobs.map(cleanGradingJob);
        if (clean.some(job => !job)) throw new Error('invalid_jobs');
        const previous = jobs;
        jobs = clean.slice(0, 10);
        confirmReferences();
        for (const job of jobs) if (job.state === 'complete' && job.request_id === activeRequest
          && previous.find(item => item.id === job.id)?.state !== 'complete') onComplete({...job});
        emit(); schedule(); return snapshot();
      } catch (error) { failed(error, stamp); return null; }
    })();
    loadPromise = promise;
    void promise.finally(() => { if (loadPromise === promise) loadPromise = null; });
    return promise;
  }
  function submit(input) {
    if (disposed || !available()) return Promise.resolve(null);
    if (submitPromise) return submitPromise;
    const stamp = generation;
    mutation++;
    submitting = true; message = ''; emit();
    const promise = (async () => {
      try {
        if (!String(input.essay || '').trim() || !input.parent_run_id && !String(input.topic || '').trim()) {
          message = '请填写题目和作文。'; return null;
        }
        const fingerprint = await gradingFingerprint(input, cryptoImpl);
        if (!valid(stamp)) return null;
        let ref = references.find(item => item.fingerprint === fingerprint);
        if (!ref) {
          const requestId = cryptoImpl.randomUUID();
          if (!UUID.test(requestId)) throw new Error('invalid_request_id');
          ref = {request_id: requestId, fingerprint, kind: input.parent_run_id ? 'second' : 'first', parent_run_id: input.parent_run_id || null};
          references.push(ref); save();
        }
        activeRequest = ref.request_id;
        const existing = jobs.find(job => job.request_id === ref.request_id);
        if (existing) {
          if (existing.state === 'complete') onComplete({...existing});
          else if (existing.retryable) message = '这次批改已有记录，请点击“继续这次批改”。';
          schedule(); return existing;
        }
        const visitor = local === true ? '' : visitorId();
        const body = await request('', {method: 'POST', headers: {'Content-Type': 'application/json',
          ...(visitor ? {'X-Visitor-ID': visitor} : {})}, body: JSON.stringify({request_id: ref.request_id,
          task_type: 'Task 2', topic: String(input.topic || ''), essay: String(input.essay),
          ...(input.parent_run_id ? {parent_run_id: input.parent_run_id} : {})})}, stamp);
        if (!body || !valid(stamp)) return null;
        const job = cleanGradingJob(body.job);
        if (!job || !local && !accountWorkspace && job.request_id !== ref.request_id || job.kind !== ref.kind || job.parent_run_id !== ref.parent_run_id)
          throw new Error('invalid_job');
        // The local server may reuse an identical submission from another tab.
        // Keep its authoritative request ID so reload and retry follow that job.
        if ((local || accountWorkspace) && job.request_id !== ref.request_id) {
          ref.request_id = job.request_id;
          activeRequest = job.request_id;
          save();
        }
        accept(job, stamp); schedule(); return job;
      } catch (error) {
        if (valid(stamp) && error.handled && error.status < 500 && error.status !== 409) {
          const ref = references.find(item => item.request_id === activeRequest);
          if (ref) { ref.confirmed = true; save(); }
        }
        failed(error, stamp); return null;
      }
      finally { if (valid(stamp)) { submitting = false; emit(); } }
    })();
    submitPromise = promise;
    void promise.finally(() => { if (submitPromise === promise) submitPromise = null; });
    return promise;
  }
  async function retry(id) {
    const job = jobs.find(item => item.id === id);
    if (!job?.retryable || submitting || disposed || !available()) return null;
    const stamp = generation;
    mutation++;
    submitting = true; activeRequest = job.request_id; message = ''; emit();
    try {
      const body = await request(`/${encodeURIComponent(id)}/retry`, {method: 'POST',
        headers: {'Content-Type': 'application/json'}, body: '{}'}, stamp);
      if (!body || !valid(stamp)) return null;
      const next = cleanGradingJob(body.job);
      if (!next || next.id !== id || next.request_id !== job.request_id) throw new Error('invalid_job');
      accept(next, stamp); schedule(); return next;
    } catch (error) { failed(error, stamp); return null; }
    finally { if (valid(stamp)) { submitting = false; emit(); } }
  }
  async function hasSubmittedDraft(input) {
    const stamp = generation;
    if (loadPromise) await loadPromise;
    if (!valid(stamp) || !references.length) return false;
    let fingerprint;
    try { fingerprint = await gradingFingerprint(input, cryptoImpl); }
    catch { return false; }
    const ref = references.find(item => item.kind === 'first' && item.fingerprint === fingerprint);
    return valid(stamp) && !!ref && jobs.some(job => job.request_id === ref.request_id && job.kind === 'first'
      && (ACTIVE.has(job.state) || job.state === 'complete'));
  }
  if (local === true) read();
  return {snapshot, load, submit, retry, visitorId, hasSubmittedDraft,
    updateToken(accessToken) { if (userId && accessToken) token = String(accessToken); },
    setIdentity(nextUserId, accessToken) {
      if (local === true) return;
      const nextId = String(nextUserId || ''), nextToken = String(accessToken || '');
      if (nextId === userId && nextToken === token) return;
      generation++; stopPoll(); for (const item of pending) item.abort(); pending.clear();
      userId = nextId; token = nextToken; submitting = false; submitPromise = null; loadPromise = null;
      jobs = []; references = []; activeRequest = ''; connection = 'idle'; message = '';
      if (userId && token) read();
      emit();
    },
    dispose() { disposed = true; generation++; stopPoll(); for (const item of pending) item.abort(); pending.clear(); token = ''; jobs = []; references = []; },
  };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export function gradingStatusMarkup(snapshot, {kind = 'first', parentRunId = ''} = {}) {
  const matches = (snapshot.jobs || []).filter(job => job.kind === kind && (kind !== 'second' || job.parent_run_id === parentRunId));
  const job = matches.find(item => ACTIVE.has(item.state) || item.retryable) || matches[0];
  if (!job && !snapshot.message && !snapshot.submitting && !snapshot.uncertain) return '';
  const labels = {queued: '已提交，正在等待批改', running: '正在批改作文', interrupted: '批改已中断，可以继续',
    failed: '这次批改暂未完成', complete: kind === 'second' ? '第二稿批改已完成' : '批改报告已保存'};
  const complete = job?.state === 'complete';
  const title = job ? labels[job.state] : snapshot.submitting ? '正在确认提交…' : '批改状态待确认';
  const messages = [snapshot.submitting && job ? '正在确认提交…' : '', job?.message, snapshot.message,
    !job && snapshot.uncertain ? '有一次提交尚待确认，重新读取可找回已受理的任务。' : '']
    .filter(value => value && !(complete && value === '批改完成，报告已保存。'));
  const active = !complete && !['offline', 'expired'].includes(snapshot.connection) && (snapshot.submitting || ACTIVE.has(job?.state));
  const motion = active ? job?.state === 'running' ? 'writing' : 'waiting' : '';
  const icon = motion === 'writing'
    ? '<path class="ep-grading-paper" d="M14 8h24l12 12v36H14z"/><path d="M38 8v12h12"/><path class="ep-grading-ink ep-grading-ink--1" pathLength="1" d="M22 28h15"/><path class="ep-grading-ink ep-grading-ink--2" pathLength="1" d="M22 36h20"/><path class="ep-grading-ink ep-grading-ink--3" pathLength="1" d="M22 44h13"/><g class="ep-grading-pen"><path d="m0 0 2-7L14-19l5 5L7-2Z"/><path d="m11-16 5 5M2-7l5 5"/></g>'
    : motion === 'waiting' ? '<circle class="ep-grading-dot" cx="20" cy="32" r="3"/><circle class="ep-grading-dot" cx="32" cy="32" r="3"/><circle class="ep-grading-dot" cx="44" cy="32" r="3"/>'
      : complete ? '<path d="m6 12 4 4 8-8"/>' : '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>';
  return `<section class="ep-grading-status${complete ? ' ep-grading-status--complete' : ''}${motion ? ` ep-grading-status--${motion}` : ''}" role="status" aria-live="polite">
    <span class="ep-grading-status__icon" aria-hidden="true"><svg viewBox="0 0 ${motion ? '64 64' : '24 24'}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>
    <div class="ep-grading-status__body"><strong>${title}</strong>${[...new Set(messages)].map(value => `<p>${escape(value)}</p>`).join('')}</div>
    <div class="ep-grading-status__actions">
      ${complete ? `<a class="ep-grading-status__primary" href="?page=report&amp;run_id=${escape(job.report_id)}">${kind === 'second' ? '查看第二稿报告' : '查看批改报告'}<span aria-hidden="true">→</span></a>` : ''}
      ${job?.retryable ? `<button type="button" class="ep-grading-status__primary" data-grading-retry="${escape(job.id)}"${snapshot.submitting ? ' disabled' : ''}>继续这次批改</button>` : ''}
      ${snapshot.connection === 'expired' ? '<a class="ep-grading-status__refresh" href="?page=login">重新登录</a>' : '<button type="button" class="ep-grading-status__refresh" data-grading-refresh><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9"/></svg>刷新状态</button>'}
    </div>
  </section>`;
}
