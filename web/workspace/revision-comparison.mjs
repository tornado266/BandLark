import {assistantReplyMarkup} from './assistant-reply-format.mjs';

// Comparison prose is not a second scoring decision. Preserve legacy text for
// inspection, but keep its band claims out of the current coaching conclusions.
const bandClaim = /\bband\s*[0-9](?:\.[05])?\b|\b[0-9](?:\.[05])?\s*bands?\b|[0-9一二三四五六七八九](?:\.[05])?\s*分(?!钟)/iu;

export function revisionComparisonMarkup(raw) {
  const source = typeof raw === 'string' ? raw.replace(/\r\n?/gu, '\n') : '';
  if (!source.trim()) return '<p>第二稿报告已保存，可以打开初稿对照查看。</p>';
  const blocks = source.split(/\n(?=(?:#{1,6}\s|[-*+]\s|\d+\.\s))|\n\s*\n/u);
  const visible = [], scoreClaims = [];
  for (const block of blocks) (bandClaim.test(block.replace(/[*_`]/gu, '')) ? scoreClaims : visible).push(block);
  return assistantReplyMarkup(visible.join('\n\n')) + (scoreClaims.length
    ? '<p role="note">对比中的分数或分档表述已单独收起。实际评分以本页评分概览为准。</p>'
      + '<details><summary>查看原始对比分档表述（不作为评分依据）</summary>'
      + assistantReplyMarkup(scoreClaims.join('\n\n')) + '</details>' : '');
}
