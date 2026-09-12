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
  assert.equal(WORKERS_AI_MODEL,'deepseek-v4.1-flash');
  assert.equal(configuredModelId(null,true,true),WORKERS_AI_MODEL);
  assert.equal(configuredModelId('mistralai/mistral-small-2603',true,true),WORKERS_AI_MODEL);
  assert.equal(configuredModelId(null,true,false),'deepseek/deepseek-v4.1-flash');
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
test('requested models and other Featured text models are available without Mistral',()=>{
  const expected = ['deepseek-v4.1-flash','kimi-k2.6','deepseek-v4-pro','glm-5.3-flash','kimi-k3','gpt-oss-120b','qwen3.8-27b','gemma-4-31b-it','minimax-m3','gemma-4-26b-a4b-it'];
  assert.deepEqual(WORKERS_AI_MODELS.map(m=>m.id),expected);
  assert.equal(configuredModelId('@cf/moonshotai/kimi-k2.6',true,true),'kimi-k2.6');
  assert.equal(WORKERS_AI_MODELS.find(m=>m.id==='kimi-k2.6')?.provider,'workers-ai');
  assert.equal(configuredModelId('glm-5.3-flash',true,false),'z-ai/glm-5.3-flash');
});

test('retired Mistral choices use DeepSeek while supported explicit choices remain selected',()=>{
  assert.equal(configuredModelId('mistral-small-2603',true,true),'deepseek-v4.1-flash');
  assert.equal(configuredModelId('mistralai/mistral-small-2603',true,false),'deepseek/deepseek-v4.1-flash');
  assert.equal(configuredModelId('deepseek-v4.1-flash',true,true),'deepseek-v4.1-flash');
  assert.equal(configuredModelId('minimax-m3',true,true),'minimax-m3');
});
