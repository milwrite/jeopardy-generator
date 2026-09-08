import {importPage,importLegacy} from './import-legacy';
import { suite, json, accountRequest, boundedBody, type SuiteEnv, type Identity } from './suite';
type Entry={id:string;title:string;revision:number;createdAt:number;updatedAt:number;content?:{record:any}};
function board(item:Entry){const r=item.content?.record||{};return {id:item.id,name:item.title,revision:item.revision,created_at:new Date(item.createdAt).toISOString(),updated_at:new Date(item.updatedAt).toISOString(),last_opened_at:null,source:r.source||'manual',ai_provider:r.ai_provider||null,ai_model:r.ai_model||null,metadata:r.metadata||{schemaVersion:1,source:'manual'},schema_version:r.schema_version||1,...(r.board_data?{board_data:r.board_data}:{})};}
async function work(env:SuiteEnv,request:Request,identity:Identity,path:string,method='GET',body?:unknown){return env.WORK_ACCOUNTS.fetch(accountRequest(request,path,identity,false,body,method));}
async function save(env:SuiteEnv,request:Request,identity:Identity,id:string,input:any){
 if(!input.board_data?.gameState?.categories||!Array.isArray(input.board_data.gameState.players))return json({error:'Invalid board data'},400);
 const record={board_data:input.board_data,source:input.source||'manual',ai_provider:input.ai_provider||null,ai_model:input.ai_model||null,metadata:input.metadata||{},schema_version:input.schema_version||1,...(input.legacy?{legacy:input.legacy}:{})};
 const text=input.board_data.gameState.categories.map((c:any)=>c.title+'\n'+c.questions.map((q:any)=>q.text+'\n'+q.answer).join('\n')).join('\n\n');
 const response=await work(env,request,identity,'/api/work/entries','PUT',{id,app:'jeopardy',kind:'board',title:input.name,expectedRevision:input.expected_revision||0,content:{schemaVersion:1,text,reading:'',contributions:[],settings:{},record}});
 const data:any=await response.json();return response.ok?json(board({...data.item,content:{record}})):json({error:data.error?.message||'Board could not be saved'},response.status);
}
export default {fetch(request:Request,env:SuiteEnv){return suite(request,env,async(req,identity)=>{
 const path=new URL(req.url).pathname;
 if(path==='/import'){if(!identity)return Response.redirect(env.PUBLIC_ORIGIN+'/auth/start?next=/import',302);return new Response(importPage,{headers:{'content-type':'text/html','cache-control':'no-store'}});}
 if(path==='/api/import/legacy'&&req.method==='POST'){if(!identity)return json({error:'CUNY Login required'},401);return importLegacy(req,env,identity,await boundedBody(req),(id,input)=>save(env,req,identity,id,input));}
 if(path==='/api/boards'||path.startsWith('/api/boards/')){
  if(!identity)return json({error:'CUNY Login required'},401);
  const id=path.slice('/api/boards/'.length);
  if(path==='/api/boards'&&req.method==='GET'){
   const response=await work(env,req,identity,'/api/work/entries?app=jeopardy&offset='+(new URL(req.url).searchParams.get('offset')||'0'));
   const data:any=await response.json();return response.ok?json({boards:data.items.map(board),nextOffset:data.nextOffset}):response;
  }
  if(path==='/api/boards'&&req.method==='POST')return save(env,req,identity,crypto.randomUUID(),await boundedBody(req));
  if(!/^[0-9a-f-]{36}$/.test(id))return json({error:'Board not found'},404);
  if(req.method==='GET'){const response=await work(env,req,identity,'/api/work/entries/'+id);const data:any=await response.json();return response.ok?json(board(data.item)):json({error:data.error?.message},response.status);}
  if(req.method==='PUT')return save(env,req,identity,id,await boundedBody(req));
  if(req.method==='DELETE')return work(env,req,identity,'/api/work/entries/'+id,'DELETE',await boundedBody(req));
  return json({error:'Method not allowed'},405);
 }
 if(path.startsWith('/api/'))return json({error:'Not found'},404);
 return env.ASSETS.fetch(req);
 });}};
