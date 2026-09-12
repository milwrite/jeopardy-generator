import assert from 'node:assert/strict';
import test from 'node:test';
import { gameCatalog, resolveGatewayModel } from '../worker/model-catalog';
test('menu and relay share the active shortlist; supported full ids normalize',async()=>{
  const gateway={fetch:async()=>Response.json({data:[
    {id:'glm-5.3',provider:'workers-ai',capabilities:['text-generation']},
    {id:'minimax-m3',provider:'openrouter',capabilities:['text-generation']},
    {id:'kimi-k3',provider:'openrouter',status:'sunset',capabilities:['text-generation']},
    {id:'deepseek-v4-flash-0731',provider:'workers-ai',capabilities:['text-generation']},
    {id:'mistral-small-2603',provider:'workers-ai',capabilities:['text-generation']},
  ]})};
  const signal=new AbortController().signal;
  assert.deepEqual((await gameCatalog(gateway,signal)).map(m=>m.id),['deepseek-v4-flash-0731','glm-5.3','minimax-m3']);
  assert.equal(await resolveGatewayModel(gateway,'@cf/zai-org/glm-5.3',signal),'glm-5.3');
  assert.equal(await resolveGatewayModel(gateway,'minimax/minimax-m3',signal),'minimax-m3');
  assert.equal(await resolveGatewayModel(gateway,'deepseek-v4-flash-0731',signal),'deepseek-v4-flash-0731');
  assert.equal(await resolveGatewayModel(gateway,'gemma-4-31b-it',signal),null);
  assert.equal(await resolveGatewayModel(gateway,'kimi-k3',signal),null);
  assert.equal(await resolveGatewayModel(gateway,'mistral-small-2603',signal),null);
});

test('requested additions resolve through the active CAIL provider only',async()=>{
  const gateway={fetch:async()=>Response.json({data:[
    {id:'kimi-k2.6',provider:'workers-ai',capabilities:['text-generation']},
    {id:'deepseek-v4-pro-0813',provider:'workers-ai',capabilities:['text-generation']},
    {id:'nemotron-3-120b-a12b',provider:'workers-ai',capabilities:['text-generation']},
    {id:'kimi-k3',provider:'workers-ai',capabilities:['text-generation']},
  ]})};
  const signal=new AbortController().signal;
  assert.deepEqual((await gameCatalog(gateway,signal)).map(m=>m.id),['deepseek-v4-pro-0813','kimi-k2.6','nemotron-3-120b-a12b']);
  assert.equal(await resolveGatewayModel(gateway,'@cf/moonshotai/kimi-k2.6',signal),'kimi-k2.6');
  assert.equal(await resolveGatewayModel(gateway,'deepseek/deepseek-v4-pro',signal),'deepseek-v4-pro-0813');
  assert.equal(await resolveGatewayModel(gateway,'@cf/nvidia/nemotron-3-120b-a12b',signal),'nemotron-3-120b-a12b');
  assert.equal(await resolveGatewayModel(gateway,'kimi-k3',signal),null);
});
