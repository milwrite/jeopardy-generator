import assert from 'node:assert/strict';
import test from 'node:test';

import { readGeneratedBoardStream } from '../src/generationProgress';

test('retains the model reported by a generated-board response', async () => {
  const content = JSON.stringify({ categories: [] });
  const response = new Response(JSON.stringify({
    model: 'provider/resolved-model',
    choices: [{ message: { content } }],
  }));

  const result = await readGeneratedBoardStream(response, 'openrouter', () => {});

  assert.equal(result.content, content);
  assert.equal(result.model, 'provider/resolved-model');
});
