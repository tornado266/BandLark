// BandLark public edition, 2026-11-23. Extracted from the production report component. See README.md.

import {createTextAnchorIndex, findTextRanges} from './text-anchor.mjs';

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
  (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;'}[char]));

const safe = (value) => escapeHtml(String(value ?? ''));
const criteria = {
  TR: {label: '逻辑论证', kind: 'logic'},
  CC: {label: '结构衔接', kind: 'structure'},
  LR: {label: '词汇表达', kind: 'vocab'},
  GRA: {label: '语法句式', kind: 'grammar'},
};
const categoryCriterion = {task_response: 'TR', coherence: 'CC', vocabulary: 'LR', expression: 'LR', grammar: 'GRA'};
const objects = (value) => Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
const criterion = (item) => criteria[item.criterion] ? item.criterion : categoryCriterion[item.category] || 'GRA';
const replacementItems = (item) => objects(item.learning_replacements);
const issueTitle = (item) => item.issue_type || item.problem || criteria[criterion(item)].label;

export function correctionPresentation(item = {}) {
  const hasRisk = Array.isArray(item.meaning_risks) && item.meaning_risks.length > 0;
  const isError = item.edit_type === 'correction' && item.meaning_status === 'preserved' && !hasRisk;
  const meaningNeedsConfirmation = hasRisk || item.edit_type === 'content_rewrite' || item.meaning_status !== 'preserved';
  const labels = {correction: '纠错建议', optional_polish: '可选润色', content_rewrite: '内容调整'};
  const base = Object.hasOwn(labels, item.edit_type) ? labels[item.edit_type] : '';
  return {isError, kind: isError ? criteria[criterion(item)].kind : 'suggestion',
    label: base ? `${base}${meaningNeedsConfirmation ? '·需确认原意' : ''}` : '修改建议·类型未标注',
    meaningNeedsConfirmation, note: typeof item.meaning_note === 'string' ? item.meaning_note : ''};
}

export function vocabularyPresentation(item = {}) {
  if (item.kind === 'recommended') return {label: '原文好词 · 推荐保留', isError: false, needsConfirmation: false, note: ''};
  if (item.kind !== 'upgrade') return {label: '词汇建议 · 类型未标注', isError: false, needsConfirmation: true, note: typeof item.meaning_note === 'string' ? item.meaning_note : ''};
  const risks = Array.isArray(item.meaning_risks) && item.meaning_risks.length > 0;
  const needsConfirmation = risks || item.edit_type === 'content_rewrite' || item.meaning_status !== 'preserved';
  const isError = item.edit_type === 'correction' && !needsConfirmation;
  const label = item.edit_type === 'content_rewrite' ? '内容调整'
    : isError ? '用词纠错建议' : item.edit_type === 'optional_polish' ? '可选表达' : '词汇建议';
  return {label, isError, needsConfirmation, note: typeof item.meaning_note === 'string' ? item.meaning_note : ''};
}

const phraseMatches = findTextRanges;

function annotateText(text, problemSpans = [], kind = '', vocabularySources = []) {
  const ranges = [
    ...problemSpans.flatMap((span) => {
      const phrase = typeof span === 'object' && span !== null ? span.phrase : span;
      const issueKind = typeof span === 'object' && span !== null ? span.kind : kind;
      if (Number.isSafeInteger(span?.start) && Number.isSafeInteger(span?.end)) {
        return span.start >= 0 && span.end > span.start && span.end <= text.length
          ? [{start: span.start, end: span.end, type: 'issue', kind: issueKind}] : [];
      }
      const found = phraseMatches(text, phrase);
      return found.length === 1 ? found.map(([start, end]) => ({start, end, type: 'issue', kind: issueKind})) : [];
    }),
    ...vocabularySources.flatMap((phrase) => phraseMatches(text, phrase).map(([start, end]) => ({start, end, type: 'vocabulary'}))),
  ];
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap(({start, end}) => [start, end])])].sort((a, b) => a - b);
  let html = '';
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end <= start) continue;
    const covering = ranges.filter((range) => range.type === 'issue' && range.start <= start && range.end >= end);
    // A paragraph-level logic anchor must not recolour a more specific grammar
    // or vocabulary correction sharing the same source text.
    const issue = covering.find((range) => range.kind !== 'logic') || covering[0];
    const vocabulary = ranges.some((range) => range.type === 'vocabulary' && range.start <= start && range.end >= end);
    const classes = [issue ? `ep-map-underline ep-map-underline--${issue.kind}` : '', vocabulary ? 'ep-vocab-wave' : ''].filter(Boolean).join(' ');
    const segment = safe(text.slice(start, end));
    html += classes ? `<span class="${classes}">${segment}</span>` : segment;
  }
  return html;
}

function annotatedEssay(essay, corrections, vocabularySources, print = false, logicBridges = [], paper = false, anchorIndex = createTextAnchorIndex(essay)) {
  const located = [];
  const unmatched = [];
  const errorLineIndices = new Set();
  corrections.forEach((item, index) => {
    const original = String(item.original || '').trim();
    const range = anchorIndex.resolve(original, item.source_anchor);
    if (!range) { unmatched.push(index + 1); return; }
    const [start, end] = range;
    located.push({start, end, index: index + 1, item});
  });
  logicBridges.slice(0, 2).forEach((bridge, index) => {
    const original = typeof bridge?.evidence === 'string' ? bridge.evidence : '';
    const range = anchorIndex.resolve(original, bridge.source_anchor);
    if (!range) return;
    const [start, end] = range;
    located.push({start, end, index: index + 1, logic: true,
      item: {criterion: 'TR', original, problem_spans: [original]}});
  });
  located.sort((a, b) => a.start - b.start || a.end - b.end);
  const groups = [];
  for (const entry of located) {
    const previous = groups[groups.length - 1];
    if (previous && entry.start < previous.end) {
      previous.end = Math.max(previous.end, entry.end);
      previous.entries.push(entry);
    } else groups.push({start: entry.start, end: entry.end, entries: [entry]});
  }
  let html = '';
  let cursor = 0;
  for (const group of groups) {
    html += annotateText(essay.slice(cursor, group.start), [], '', vocabularySources);
    const segment = essay.slice(group.start, group.end);
    const spans = group.entries.flatMap((entry) => {
      if (!entry.logic && !correctionPresentation(entry.item).isError) return [];
      const issueSpans = Array.isArray(entry.item.problem_spans) ? entry.item.problem_spans : [];
      const ownText = essay.slice(entry.start, entry.end);
      const ownSpans = issueSpans.flatMap((phrase) => {
        const found = phraseMatches(ownText, phrase);
        return found.length === 1 ? found.map(([start, end]) => ({
          start: entry.start - group.start + start, end: entry.start - group.start + end,
          kind: criteria[criterion(entry.item)].kind,
        })) : [];
      });
      if (ownSpans.length && !entry.logic) errorLineIndices.add(entry.index);
      return ownSpans;
    });
    const primary = group.entries.find((entry) => !entry.logic) || group.entries[0];
    const primaryKind = primary.logic ? 'logic' : correctionPresentation(primary.item).kind;
    const hit = (entry, content, kind) => paper
      ? `<button type="button" class="ep-paper-hit ep-paper-hit--${kind}" id="ep-paper-source-${entry.logic ? 'L' : ''}${entry.index}" data-paper-note="${entry.logic ? 'L' : ''}${entry.index}" aria-controls="ep-paper-explanation-${entry.logic ? 'L' : ''}${entry.index}" aria-pressed="false" aria-label="查看${entry.logic ? '逻辑批注 L' : '批注 '}${entry.index}">${content}</button>`
      : print
      ? `<span class="ep-map-hit ep-map-hit--${kind}">${content}</span>`
      : entry.logic
        ? `<button type="button" class="ep-map-hit ep-map-hit--logic" id="ep-map-logic-source-${entry.index}" data-map-logic="${entry.index}" aria-controls="report-logic-bridge-${entry.index}" aria-pressed="false" aria-label="查看第 ${entry.index} 处逻辑缺口">${content}</button>`
        : `<button type="button" class="ep-map-hit ep-map-hit--${kind}" id="ep-map-source-${entry.index}" data-map-issue="${entry.index}" aria-pressed="${entry.index === 1}" aria-label="查看第 ${entry.index} 条${safe(correctionPresentation(entry.item).label)}">${content}</button>`;
    const primaryContent = `${annotateText(segment, spans, '', vocabularySources)}<sup class="ep-map-index">${primary.logic ? 'L' : ''}${primary.index}</sup>`;
    html += hit(primary, primaryContent, primaryKind);
    for (const entry of group.entries.filter((entry) => entry !== primary)) {
      const number = `<sup class="ep-map-index">${entry.logic ? 'L' : ''}${entry.index}</sup>`;
      html += hit(entry, number, entry.logic ? 'logic' : correctionPresentation(entry.item).kind);
    }
    cursor = group.end;
  }
  html += annotateText(essay.slice(cursor), [], '', vocabularySources);
  return {html: paper ? html : html.replace(/\n/g, '<br>'), unmatched, errorLineIndices,
    locatedIndices: new Set(located.filter((entry) => !entry.logic).map((entry) => entry.index)),
    locatedLogicIndices: new Set(located.filter((entry) => entry.logic).map((entry) => entry.index))};
}

export function orderedCorrections(essay, corrections, anchorIndex = createTextAnchorIndex(essay)) {
  return corrections.map((item, index) => ({item, index, position: anchorIndex.resolve(item.original, item.source_anchor)?.[0] ?? Infinity}))
    .sort((a, b) => a.position - b.position || a.index - b.index).map(({item}) => item);
}

function vocabularySourcesFor(ordered, vocabulary) {
  return [...new Set([
    ...vocabulary.filter((item) => vocabularyPresentation(item).isError).map((item) => String(item.source || '').trim()),
    ...ordered.filter((item) => correctionPresentation(item).isError).flatMap((item) => replacementItems(item).map((replacement) => String(replacement.source || '').trim())),
  ].filter(Boolean))];
}

// The paper template shares the original map's locator, overlap grouping and
// numbering. Its optional presentation never changes existing screen/print HTML.
export function paperOriginalModel(essay, corrections, vocabulary, {logicBridges = []} = {}) {
  const essayText = String(essay || '');
  const anchorIndex = createTextAnchorIndex(essayText);
  const normalized = objects(corrections).map((item) => ({...item, criterion: Object.hasOwn(criteria, item.criterion)
    ? item.criterion : Object.hasOwn(categoryCriterion, item.category) ? categoryCriterion[item.category] : 'GRA'}));
  const ordered = orderedCorrections(essayText, normalized, anchorIndex);
  const sources = vocabularySourcesFor(ordered, objects(vocabulary));
  const bridges = objects(logicBridges).slice(0, 2);
  const located = annotatedEssay(essayText, ordered, sources, true, bridges, true, anchorIndex);
  return {...located, corrections: ordered, logicBridges: bridges,
    hasVocabulary: sources.some((source) => phraseMatches(essayText, source).length > 0)};
}
