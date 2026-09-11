import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredModelId, WORKERS_AI_MODEL, WORKERS_AI_MODELS, getOpenRouterModelOptions, getOpenRouterBoardResponseFormat } from '../src/openRouterModels';

test('new hosted sessions default to verified DeepSeek Flash, without changing direct-key defaults', () => {
  assert.equal(WORKERS_AI_MODEL, '@cf/deepseek-ai/deepseek-v4-flash-0731');
  assert.equal(configuredModelId(null, true, true), WORKERS_AI_MODEL);
  assert.equal(configuredModelId('', false, true), 'google/gemini-3.1-flash-lite');
  assert.equal(configuredModelId(null, true, false), 'google/gemini-3.1-flash-lite');
});

test('saved selections are preserved across board and final-round configuration', () => {
  for (const {id} of WORKERS_AI_MODELS) {
    assert.equal(configuredModelId(id, true, true), id);
    assert.deepEqual(getOpenRouterBoardResponseFormat(id), {type:'json_object'});
    assert.deepEqual(getOpenRouterModelOptions(id), {chat_template_kwargs:{enable_thinking:false}});
  }
  assert.equal(configuredModelId('moonshotai/kimi-k2.6', true, true), 'moonshotai/kimi-k2.6');
});

test('picker includes the requested larger models and distinct alternatives', () => {
  const ids = WORKERS_AI_MODELS.map(model => model.id);
  assert.ok(ids.includes('@cf/deepseek-ai/deepseek-v4-flash-0731'));
  assert.ok(ids.includes('@cf/moonshotai/kimi-k2.6'));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 10);
});
