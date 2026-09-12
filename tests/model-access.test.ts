import assert from 'node:assert/strict';
import test from 'node:test';
import { suite, type SuiteEnv } from '../worker/suite';

const origin = 'https://jeopardy.ailab-452.workers.dev';
const request = (model: string, cookie?: string) => new Request(`${origin}/api/ai/chat`, {
  method:'POST', headers:{origin,'content-type':'application/json',...(cookie ? {cookie} : {})},
  body:JSON.stringify({model,messages:[{role:'user',content:'Test prompt'}]}),
});

test('anonymous users cannot use included inference for any provider', async () => {
  let calls = 0;
  const env = { PUBLIC_ORIGIN:origin, APP_ID:'jeopardy', GATEWAY:{fetch:async()=>{calls++;return Response.json({});}} } as unknown as SuiteEnv;
  for (const model of ['@cf/moonshotai/kimi-k2.6','deepseek/deepseek-v4-flash']) {
    const response = await suite(request(model), env, async()=>Response.json({}));
    assert.equal(response.status,401);
  }
  assert.equal(calls,0);
});

test('signed-in requests keep their selected model and use verified CUNY gateway identity', async () => {
  let calls = 0;
  const model = '@cf/zai-org/glm-5.3';
  const env = {
    PUBLIC_ORIGIN:origin, APP_ID:'jeopardy',
    IDENTITY:{identities:async()=>({ok:true,appJwt:'app-test',gatewayJwt:'gateway-test',workspaceJwt:null})},
    REQUEST_LIMIT:{limit:async()=>({success:true})},
    GATEWAY:{fetch:async(r:Request)=>{
      if(new URL(r.url).pathname==='/v1/catalog')return Response.json({data:[{id:'glm-5.3',provider:'workers-ai',status:'active',capabilities:['text-generation']}]});
      calls++;
      assert.equal(r.headers.get('authorization'),'Bearer gateway-test');
      assert.equal((await r.json() as {model:string}).model,'glm-5.3');
      return Response.json({model,choices:[]});
    }},
  } as unknown as SuiteEnv;
  const response = await suite(request(model,'__Host-jeopardy-session=test-session'),env,async()=>Response.json({}));
  assert.equal(response.status,200);
  assert.equal(calls,1);
});

test('expired sign-in never falls back to guest inference', async () => {
  const env = {PUBLIC_ORIGIN:origin,APP_ID:'jeopardy',IDENTITY:{identities:async()=>({ok:false,status:401})}} as unknown as SuiteEnv;
  const response = await suite(request('deepseek/deepseek-v4-flash','__Host-jeopardy-session=expired'),env,async()=>Response.json({}));
  assert.equal(response.status,401);
});
