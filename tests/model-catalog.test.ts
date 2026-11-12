import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gameCatalog, resolveGatewayModel } from '../worker/model-catalog';
const live=JSON.parse(readFileSync(new URL('./fixtures/cail-models-2026-11-12.json',import.meta.url),'utf8'));
test('all ten choices intersect the captured live registry, including AWS Kimi and MiniMax',async()=>{
  const gateway={fetch:async()=>Response.json({data:live})};
  const signal=new AbortController().signal;
  const models=await gameCatalog(gateway,signal);
  assert.equal(models.length,10);
  assert.equal(models.find(m=>m.id==='kimi-k3')?.provider,'bedrock-runtime');
  assert.equal(models.find(m=>m.id==='minimax-m2.5')?.provider,'bedrock-mantle');
  assert.equal(await resolveGatewayModel(gateway,'moonshotai/kimi-k3',signal),'kimi-k3');
  assert.equal(await resolveGatewayModel(gateway,'@cf/moonshotai/kimi-k2.6',signal),'kimi-k2.5');
  assert.equal(await resolveGatewayModel(gateway,'minimax-m3',signal),'minimax-m2.5');
  assert.equal(await resolveGatewayModel(gateway,'gemma-4-26b-a4b-it',signal),'gemma-4-26b-a4b-it');
  assert.equal(await resolveGatewayModel(gateway,'not-in-the-registry',signal),null);
});
test('inactive entries, wrong providers, and non-text models never become playable',async()=>{
  const gateway={fetch:async()=>Response.json({data:[
    {id:'kimi-k3',provider:'openrouter',capabilities:['text-generation']},
    {id:'minimax-m2.5',provider:'bedrock-mantle',status:'sunset',capabilities:['text-generation']},
    {id:'gemma-4-26b-a4b-it',provider:'workers-ai',capabilities:['vision']},
  ]})};
  assert.deepEqual(await gameCatalog(gateway,new AbortController().signal),[]);
});
