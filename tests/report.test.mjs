import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextAnchorIndex, sourceTextSha256} from '../web/workspace/text-anchor.mjs';
import {paperOriginalModel} from '../web/workspace/report-original.mjs';
import {sentenceChanges, wordDiffMarkup} from '../web/workspace/word-diff.mjs';
import {revisionComparisonMarkup} from '../web/workspace/revision-comparison.mjs';
import {cleanGradingJob} from '../web/workspace/grading-client.mjs';

test('normalized quotes preserve original offsets', () => {
  const essay = 'A trip was planned. The group’s  timetable changed.';
  const source = 'The group’s  timetable changed.';
  const index = createTextAnchorIndex(essay);
  const [start, end] = index.resolve("the group's timetable changed.");
  assert.equal(essay.slice(start, end), source);
});

test('ambiguous and stale references do not silently select another sentence', () => {
  const essay = 'Teams meet. Teams meet.';
  const index = createTextAnchorIndex(essay);
  assert.equal(index.resolve('Teams meet.'), null);
  const anchor = {version: 1, source_sha256: sourceTextSha256(essay), start_utf16: 12, end_utf16: 23};
  assert.deepEqual(index.resolve('Teams meet.', anchor), [12, 23]);
  assert.equal(createTextAnchorIndex('New. ' + essay).resolve('Teams meet.', anchor), null);
});

test('report marks only supported quotes and escapes visible user text', () => {
  const report = paperOriginalModel('One <group> meets.', [
    {original: '<group>', criterion: 'GRA'}, {original: 'missing'}
  ], []);
  assert.deepEqual([...report.locatedIndices], [1]);
  assert.deepEqual(report.unmatched, [2]);
  assert.match(report.html, /&lt;group&gt;/);
});

test('word diff and revision display use safe HTML for user input', () => {
  const change = sentenceChanges('Birds fly.', 'Birds can fly.');
  assert.equal(change.state, 'changed');
  assert.ok(change.parts.some(part => part.kind === 'added' && part.text.includes('can')));
  assert.doesNotMatch(wordDiffMarkup('<x>', '<y>'), /<(x|y)>/);
  assert.match(revisionComparisonMarkup('Band 7.0'), /<details>/);
});

test('completed grading jobs require a valid report reference', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const job = {id, request_id: id, kind: 'first', state: 'complete'};
  assert.equal(cleanGradingJob(job), null);
  assert.equal(cleanGradingJob({...job, report_id: id}).state, 'complete');
});
