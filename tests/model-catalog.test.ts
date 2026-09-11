import assert from 'node:assert/strict';
import test from 'node:test';
import { gameCatalog, resolveGatewayModel } from '../worker/model-catalog';
test('menu and relay share the active shortlist; supported full ids normalize',async()=>{
  const gateway={fetch:async()=>Response.json({data:[
    {id:'qwen3.8-27b',provider:'workers-ai',capabilities:['text-generation']},
    {id:'minimax-m3',provider:'openrouter',capabilities:['text-generation']},
    {id:'gemma-4-31b-it',provider:'openrouter',status:'sunset',capabilities:['text-generation']},
    {id:'deepseek-v4-flash-0731',provider:'workers-ai',capabilities:['text-generation']},
    {id:'mistral-small-2603',provider:'workers-ai',capabilities:['text-generation']},
  ]})};
  const signal=new AbortController().signal;
  assert.deepEqual((await gameCatalog(gateway,signal)).map(m=>m.id),['qwen3.8-27b','minimax-m3']);
  assert.equal(await resolveGatewayModel(gateway,'@cf/qwen/qwen3.8-27b',signal),'qwen3.8-27b');
  assert.equal(await resolveGatewayModel(gateway,'minimax/minimax-m3',signal),'minimax-m3');
  assert.equal(await resolveGatewayModel(gateway,'deepseek-v4-flash-0731',signal),null);
  assert.equal(await resolveGatewayModel(gateway,'gemma-4-31b-it',signal),null);
  assert.equal(await resolveGatewayModel(gateway,'mistral-small-2603',signal),null);
});
