import assert from 'node:assert/strict';
import test from 'node:test';
import { generationBudget, GAME_MODELS } from '../src/gameModels';
import { configuredModelId, WORKERS_AI_MODEL, getOpenRouterModelOptions, getOpenRouterBoardResponseFormat, getFinalClueResponseFormat } from '../src/openRouterModels';
test('the ten choices retain the requested families and the recommended default',()=>{
  assert.deepEqual(GAME_MODELS.map(m=>m.id),['deepseek-v4.1-flash-1017','kimi-k3','kimi-k2.5','deepseek-v4-pro-0813','glm-5.3-flash','gemma-4-26b-a4b-it','minimax-m2.5','nemotron-super-3-120b','gpt-oss-120b','qwen3.8-27b']);
  assert.equal(WORKERS_AI_MODEL,'deepseek-v4.1-flash-1017');
  assert.equal(configuredModelId(null,true,true),WORKERS_AI_MODEL);
  assert.equal(configuredModelId('unlisted',true,true),WORKERS_AI_MODEL);
});
test('saved old routes migrate while current choices stay selected',()=>{
  for(const m of GAME_MODELS) assert.equal(configuredModelId(m.id,true,true),m.id);
  assert.equal(configuredModelId('@cf/moonshotai/kimi-k2.6',true,true),'kimi-k2.5');
  assert.equal(configuredModelId('minimax/minimax-m3',true,true),'minimax-m2.5');
  assert.equal(configuredModelId('@cf/zai-org/glm-5.3',true,true),'glm-5.3-flash');
  assert.equal(configuredModelId('nemotron-3-120b-a12b',true,true),'nemotron-super-3-120b');
  assert.equal(configuredModelId('deepseek-v4-flash-0731',true,true),WORKERS_AI_MODEL);
  assert.equal(configuredModelId('gemma-4-26b-a4b-it',true,true),'gemma-4-26b-a4b-it');
});
test('AWS model requests omit unsupported thinking fields and reserve visible output',()=>{
  for(const id of ['kimi-k3','kimi-k2.5','minimax-m2.5','nemotron-super-3-120b']){
    assert.deepEqual(getOpenRouterModelOptions(id),{});
    assert.equal(generationBudget(id,80),2048);
    assert.equal(generationBudget(id,5000),8000);
  }
  assert.deepEqual(getOpenRouterModelOptions('glm-5.3-flash'),{chat_template_kwargs:{enable_thinking:false}});
  assert.equal(generationBudget('glm-5.3-flash',80),2048);
  assert.equal(generationBudget('glm-5.3-flash',5000),8000);
  assert.equal(generationBudget(WORKERS_AI_MODEL,80),80);
});
test('board and final request only supported output modes and schemas match content',()=>{
  for(const id of ['kimi-k3','kimi-k2.5','minimax-m2.5','nemotron-super-3-120b','gpt-oss-120b']) {
    assert.equal(getOpenRouterBoardResponseFormat(id).type,'json_schema');
    assert.equal(getFinalClueResponseFormat(id).type,'json_schema');
  }
  for(const id of ['deepseek-v4.1-flash-1017','deepseek-v4-pro-0813','glm-5.3-flash','gemma-4-26b-a4b-it','qwen3.8-27b']) {
    assert.deepEqual(getOpenRouterBoardResponseFormat(id),{type:'json_object'});
    assert.deepEqual(getFinalClueResponseFormat(id),{type:'json_object'});
  }
  const board:any=getOpenRouterBoardResponseFormat('kimi-k2.5');
  const categories=board.json_schema.schema.properties.categories;
  assert.equal(categories.minItems,6);assert.equal(categories.maxItems,6);
  assert.equal(categories.items.properties.questions.minItems,5);
  assert.deepEqual(categories.items.properties.questions.items.required,['text','answer']);
});
test('personal OpenRouter requests keep provider-specific ids',()=>{
  assert.equal(configuredModelId('kimi-k3',true,false),'moonshotai/kimi-k3');
  assert.equal(configuredModelId('minimax-m2.5',true,false),'minimax/minimax-m2.5');
});
