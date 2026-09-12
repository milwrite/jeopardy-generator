import assert from 'node:assert/strict';
import test from 'node:test';
import { generationBudget } from '../src/gameModels';
import { configuredModelId, WORKERS_AI_MODEL, WORKERS_AI_MODELS, getOpenRouterModelOptions, getOpenRouterBoardResponseFormat } from '../src/openRouterModels';
test('MiniMax gets reasoning room for Final without reducing full-board budgets',()=>{
  assert.equal(generationBudget('minimax-m3',600),2048);
  assert.equal(generationBudget('minimax-m3',8000),8000);
  assert.equal(generationBudget('deepseek-v4-flash-0731',600),600);
});
test('new sessions and retired choices use the current Featured default',()=>{
  assert.equal(WORKERS_AI_MODEL,'deepseek-v4-flash-0731');
  assert.equal(configuredModelId(null,true,true),WORKERS_AI_MODEL);
  assert.equal(configuredModelId('mistralai/mistral-small-2603',true,true),WORKERS_AI_MODEL);
  assert.equal(configuredModelId(null,true,false),'minimax/minimax-m3');
});
test('saved supported routes normalize without changing the selected model',()=>{
  assert.equal(configuredModelId('@cf/zai-org/glm-5.3',true,true),'glm-5.3');
  assert.equal(configuredModelId('minimax/minimax-m3',true,true),'minimax-m3');
  assert.equal(configuredModelId('minimax-m3',true,false),'minimax/minimax-m3');
  for (const {id,provider} of WORKERS_AI_MODELS) {
    assert.equal(configuredModelId(id,true,true),id);
    assert.deepEqual(getOpenRouterBoardResponseFormat(id),{type:'json_object'});
    assert.deepEqual(getOpenRouterModelOptions(id),provider==='workers-ai'?{chat_template_kwargs:{enable_thinking:false}}:{reasoning:{enabled:false}});
  }
});
test('requested models and other Featured text models are available without Mistral',()=>{
  const expected = ['deepseek-v4-flash-0731','deepseek-v4-pro-0813','kimi-k2.6','glm-5.3','nemotron-3-120b-a12b','kimi-k3','gpt-oss-120b','minimax-m3'];
  assert.deepEqual(WORKERS_AI_MODELS.map(m=>m.id),expected);
  assert.equal(configuredModelId('@cf/moonshotai/kimi-k2.6',true,true),'kimi-k2.6');
  assert.equal(WORKERS_AI_MODELS.find(m=>m.id==='kimi-k2.6')?.provider,'workers-ai');
  assert.deepEqual(WORKERS_AI_MODELS.filter(m=>m.provider==='openrouter').map(m=>m.id),['kimi-k3','minimax-m3']);
});

test('retired Mistral choices use DeepSeek while supported explicit choices remain selected',()=>{
  assert.equal(configuredModelId('mistral-small-2603',true,true),'deepseek-v4-flash-0731');
  assert.equal(configuredModelId('mistralai/mistral-small-2603',true,false),'minimax/minimax-m3');
  assert.equal(configuredModelId('deepseek-v4-flash-0731',true,true),'deepseek-v4-flash-0731');
  assert.equal(configuredModelId('minimax-m3',true,true),'minimax-m3');
});

test('former default and compact Gemma retire while Pro moves to its Workers AI release',()=>{
  assert.equal(configuredModelId('deepseek-v4.1-flash',true,true),'deepseek-v4-flash-0731');
  assert.equal(configuredModelId('gemma-4-26b-a4b-it',true,true),'deepseek-v4-flash-0731');
  assert.equal(configuredModelId('deepseek-v4-pro',true,true),'deepseek-v4-pro-0813');
  assert.equal(configuredModelId('deepseek-v4-pro-0813',true,false),'minimax/minimax-m3');
});
