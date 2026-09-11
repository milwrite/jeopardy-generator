import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGatewayModel } from '../worker/model-catalog';

test('full Workers AI ids resolve to active gateway aliases without rewriting other providers',async()=>{
  const gateway={fetch:async()=>Response.json({data:[
    {id:'kimi-k2.6',provider:'workers-ai'},
    {id:'gemma-4-26b-a4b-it',provider:'workers-ai'},
    {id:'retired-model',provider:'workers-ai',status:'sunset'},
    {id:'deepseek/deepseek-v4-flash',provider:'openrouter'},
  ]})};
  const signal=new AbortController().signal;
  assert.equal(await resolveGatewayModel(gateway,'@cf/moonshotai/kimi-k2.6',signal),'kimi-k2.6');
  assert.equal(await resolveGatewayModel(gateway,'gemma-4-26b-a4b-it',signal),'gemma-4-26b-a4b-it');
  assert.equal(await resolveGatewayModel(gateway,'deepseek/deepseek-v4-flash',signal),'deepseek/deepseek-v4-flash');
  assert.equal(await resolveGatewayModel(gateway,'@cf/other/retired-model',signal),null);
  assert.equal(await resolveGatewayModel(gateway,'@cf/other/unlisted',signal),null);
});
