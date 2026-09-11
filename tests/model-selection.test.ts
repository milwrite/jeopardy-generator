import assert from 'node:assert/strict';
import test from 'node:test';
import { generationBudget } from '../src/gameModels';
import { configuredModelId, WORKERS_AI_MODEL, WORKERS_AI_MODELS, getOpenRouterModelOptions, getOpenRouterBoardResponseFormat } from '../src/openRouterModels';
test('MiniMax gets reasoning room for Final without reducing full-board budgets',()=>{
  assert.equal(generationBudget('minimax-m3',600),2048);
  assert.equal(generationBudget('minimax-m3',8000),8000);
  assert.equal(generationBudget('deepseek-v4.1-flash',600),600);
});
test('new sessions and retired choices use the current Featured default',()=>{
  assert.equal(WORKERS_AI_MODEL,'mistral-small-2603');
  assert.equal(configuredModelId(null,true,true),WORKERS_AI_MODEL);
  assert.equal(configuredModelId('@cf/moonshotai/kimi-k2.6',true,true),WORKERS_AI_MODEL);
  assert.equal(configuredModelId(null,true,false),'mistralai/mistral-small-2603');
});
test('saved supported routes normalize without changing the selected model',()=>{
  assert.equal(configuredModelId('@cf/qwen/qwen3.8-27b',true,true),'qwen3.8-27b');
  assert.equal(configuredModelId('minimax/minimax-m3',true,true),'minimax-m3');
  assert.equal(configuredModelId('minimax-m3',true,false),'minimax/minimax-m3');
  for (const {id,provider} of WORKERS_AI_MODELS) {
    assert.equal(configuredModelId(id,true,true),id);
    assert.deepEqual(getOpenRouterBoardResponseFormat(id),{type:'json_object'});
    assert.deepEqual(getOpenRouterModelOptions(id),provider==='workers-ai'?{chat_template_kwargs:{enable_thinking:false}}:{reasoning:{enabled:false}});
  }
});
test('choices are a Featured subset plus the two explicit additions',()=>{
  const featured=new Set(['deepseek-v4.1-flash','kimi-k3','glm-5.3','qwen3.8-27b','gpt-oss-120b','gemma-4-31b-it','mistral-small-2603']);
  const extras=new Set(['minimax-m3','gemma-4-26b-a4b-it']);
  assert.equal(WORKERS_AI_MODELS.length,6);
  assert.ok(WORKERS_AI_MODELS.every(m=>featured.has(m.id)||extras.has(m.id)));
  assert.ok(WORKERS_AI_MODELS.some(m=>m.id==='minimax-m3'));
});
