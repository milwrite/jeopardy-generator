import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeneratedBoard, parseFinalClue, waitForRetry } from '../src/generatedBoard';
const board = () => ({ categories: Array.from({ length: 6 }, (_, c) => ({ title: `Category ${c}`, questions: Array.from({ length: 5 }, (_, q) => ({ text: `Clue ${q}`, answer: 'What is a response?', value: 1 })) })) });
test('complete content is retained and prices are normalized without a new model call', () => {
  const data = board();
  const parsed = parseGeneratedBoard('```json\n' + JSON.stringify(data) + '\n```');
  assert.deepEqual(parsed.categories[0].questions.map(q => q.value), [200, 400, 600, 800, 1000]);
  assert.equal(parsed.categories[5].questions[4].text, 'Clue 4');
});
test('missing categories, clues, and answers never become placeholder boards', () => {
  const data = board();
  data.categories.pop();
  assert.throws(() => parseGeneratedBoard(JSON.stringify(data)), /six categories/);
  const missingClue = board(); missingClue.categories[0].questions.pop();
  assert.throws(() => parseGeneratedBoard(JSON.stringify(missingClue)), /incomplete category/);
  const missingAnswer = board(); missingAnswer.categories[0].questions[0].answer = '';
  assert.throws(() => parseGeneratedBoard(JSON.stringify(missingAnswer)), /without an answer/);
  assert.throws(() => parseGeneratedBoard('{"categories":['), /invalid board JSON/);
});
test('Final Jeopardy rejects errors and missing answers instead of creating playable clues', () => {
  assert.throws(() => parseFinalClue('Generation failed'), /incomplete/);
  assert.throws(() => parseFinalClue('{"category":"X","clue":"Y"}'), /missing/);
  assert.deepEqual(parseFinalClue('{"category":"X","clue":"Y","answer":"What is Z?"}'), { category: 'X', clue: 'Y', answer: 'What is Z?' });
});
test('cancellation interrupts retry backoff', async () => {
  const controller = new AbortController();
  const pending = waitForRetry(30_000, controller.signal);
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
});
