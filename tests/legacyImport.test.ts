import test from 'node:test';
import assert from 'node:assert/strict';
import {importLegacy} from '../worker/import-legacy';
import type {SuiteEnv,Identity} from '../worker/suite';

test('legacy import preserves board contents, skips duplicates, and never forwards credentials to storage',async()=>{
 const original=globalThis.fetch,entries=new Map<string,unknown>(),calls:string[]=[];
 const board={id:7,name:'Old board',board_data:{gameState:{categories:[],players:[]}},created_at:'2026-01-01'};
 const env={LEGACY_ORIGIN:'https://legacy.example',REQUEST_LIMIT:{limit:async()=>({success:true})},WORK_ACCOUNTS:{fetch:async(r:Request)=>{const id=new URL(r.url).pathname.split('/').at(-1)!;return new Response('{}',{status:entries.has(id)?200:404});}}} as unknown as SuiteEnv;
 globalThis.fetch=(async(url:string,options?:RequestInit)=>{
  calls.push(url);
  if(url.endsWith('/login')){assert.deepEqual(JSON.parse(options!.body as string),{login:'owner',password:'old-password'});return new Response(JSON.stringify({userId:1}),{headers:{'set-cookie':'session=temporary; Secure; HttpOnly'}});}
  assert.equal(new Headers(options?.headers).get('cookie'),'session=temporary');
  if(url.endsWith('/logout'))throw new Error('Temporary logout outage');
  return Response.json(url.endsWith('/7')?board:[{id:7}]);
 }) as typeof fetch;
 const identity={ok:true,appJwt:'verified'} as Identity,request=new Request('https://jeopardy.example/api/import/legacy');
 const save=async(id:string,data:unknown)=>{entries.set(id,data);return Response.json({});};
 try{
  const first=await importLegacy(request,env,identity,{login:'owner',password:'old-password'},save);
  assert.deepEqual(await first.json(),{imported:1,existing:0,failed:0});
  const second=await importLegacy(request,env,identity,{login:'owner',password:'old-password'},save);
  assert.deepEqual(await second.json(),{imported:0,existing:1,failed:0});
  assert.equal(entries.size,1);const saved=Array.from(entries.values())[0] as any;
  assert.deepEqual(saved.board_data,board.board_data);assert.equal(saved.legacy.boardId,7);
  assert.doesNotMatch(JSON.stringify(saved),/old-password|temporary/);
  assert.equal(calls.filter(c=>c.endsWith('/7')).length,1);
 }finally{globalThis.fetch=original;}
});
