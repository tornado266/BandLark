import {paperOriginalModel} from './web/workspace/report-original.mjs';
import {wordDiffMarkup} from './web/workspace/word-diff.mjs';
import {revisionComparisonMarkup} from './web/workspace/revision-comparison.mjs';

const element = id => document.getElementById(id);
function render() {
  const draft = element('essay').value;
  const quote = element('quote').value.trim();
  const revised = element('revised').value.trim();
  const item = {original: quote, improved: revised, criterion: 'GRA'};
  const report = paperOriginalModel(draft, [item], []);
  element('paper').innerHTML = report.html;
  element('status').textContent = report.locatedIndices.has(1)
    ? '已找到唯一匹配。点击标记查看对应修改。'
    : '原句尚未唯一定位。请检查引用是否出现在原文中，或补充上下文以区分重复的句子。';
  element('difference').innerHTML = wordDiffMarkup(quote, revised);
}
element('inputs').addEventListener('submit', event => {
  event.preventDefault();
  render();
});
element('paper').addEventListener('click', event => {
  const source = event.target.closest('[data-paper-note]');
  if (!source) return;
  source.setAttribute('aria-pressed', 'true');
  element('ep-paper-explanation-1').focus();
});
element('comparison').innerHTML = revisionComparisonMarkup(
  '### 对照意见\n- 在示例中，动词改为 gives，与单数主语 timetable 一致。\n\n### 下一稿\n- 检查每个长句的主语，再核对动词形式。'
);
render();
