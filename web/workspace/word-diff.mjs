import {diffArrays} from './vendor/jsdiff/array.mjs';

// This is a sentence comparison, not an essay diff or a correctness judgment.
export const WORD_DIFF_LIMITS = Object.freeze({characters: 2400, tokens: 800, edits: 128, timeout: 8});

const escape = (value) => value.replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

// Keep English contractions together, but keep punctuation and every whitespace
// byte as explicit tokens. Unicode code points are never split into surrogates.
export function wordDiffTokens(text) {
  return text.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|\r\n|[^\S\r\n]+|[\s\S]/gu) || [];
}

export function sentenceChanges(original, improved) {
  if (typeof original !== 'string' || typeof improved !== 'string') return {state: 'unavailable', parts: []};
  if (original === improved) return {state: 'same', parts: original ? [{kind: 'same', text: original}] : []};
  if (original.length > WORD_DIFF_LIMITS.characters || improved.length > WORD_DIFF_LIMITS.characters) {
    return {state: 'limited', parts: []};
  }
  const before = wordDiffTokens(original);
  const after = wordDiffTokens(improved);
  if (before.length + after.length > WORD_DIFF_LIMITS.tokens) return {state: 'limited', parts: []};
  const changes = diffArrays(before, after, {maxEditLength: WORD_DIFF_LIMITS.edits, timeout: WORD_DIFF_LIMITS.timeout});
  if (!changes) return {state: 'limited', parts: []};
  return {
    state: 'changed',
    whitespaceOnly: original.replace(/\s/gu, '') === improved.replace(/\s/gu, ''),
    parts: changes.map(({added, removed, value}) => ({kind: added ? 'added' : removed ? 'removed' : 'same', text: value.join('')})),
  };
}

export function wordDiffMarkup(original, improved, {print = false} = {}) {
  const comparison = sentenceChanges(original, improved);
  if (comparison.state === 'unavailable' || (!original && !improved)) return '';
  if (comparison.state === 'same') return '<p class="ep-word-diff__note">原句与建议文字相同。</p>';
  if (comparison.state === 'limited') return '<p class="ep-word-diff__note">本处改动较多，请对照上方原句与建议查看。</p>';
  const text = comparison.parts.map(({kind, text: value}) => {
    const content = escape(value);
    if (kind === 'removed') return `<del class="ep-word-diff__removed" title="删去">${content}</del>`;
    if (kind === 'added') return `<ins class="ep-word-diff__added" title="新增">${content}</ins>`;
    return content;
  }).join('');
  const content = `<div class="ep-word-diff__legend"><span><del>删去</del></span><span><ins>新增</ins></span></div>${comparison.whitespaceOnly ? '<p class="ep-word-diff__note">本处仅空白或换行发生变化。</p>' : ''}<div class="ep-word-diff__text" aria-label="原句与建议的文字差异">${text}</div>`;
  return `<section class="ep-word-diff${print ? ' ep-word-diff--print' : ''}" aria-label="具体改动"><div class="ep-word-diff__title">具体改动</div>${content}</section>`;
}
