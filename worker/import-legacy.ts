import {json,accountRequest,type SuiteEnv,type Identity} from './suite';
export const importPage=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Import previous boards</title><style>body{max-width:520px;margin:70px auto;padding:24px;font:16px/1.6 system-ui;background:#111;color:#ddd}a{color:inherit}label,input,button{display:block}input,button{box-sizing:border-box;margin:8px 0 20px;padding:10px;width:100%;font:inherit}button{cursor:pointer}</style><a href="/">Jeopardy</a><h1>Import previous boards</h1><p>Copy boards from your Inference Arcade account into your CUNY account. The original boards remain available.</p><form><label>Previous username or email<input name="login" autocomplete="username" required></label><label>Previous password<input type="password" name="password" autocomplete="current-password" required></label><button>Import boards</button></form><p role="status"></p><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),status=document.querySelector('[role=status]');button.disabled=true;status.textContent='Importing…';try{const r=await fetch('/api/import/legacy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await r.json();form.password.value='';status.textContent=r.ok?data.imported+' imported, '+data.existing+' already imported, '+data.failed+' could not be imported.':data.error?.message||data.error||'Import failed';}catch{status.textContent='Import unavailable. Try again.'}finally{button.disabled=false;}};</script></html>`;
export async function importLegacy(request:Request,env:SuiteEnv,identity:Identity,input:any,save:(id:string,body:any)=>Promise<Response>){
 if(typeof input.login!=='string'||input.login.length>254||typeof input.password!=='string'||input.password.length>128)return json({error:'Enter the previous account credentials.'},400);
 if(!(await env.REQUEST_LIMIT.limit({key:'import:'+request.headers.get('cf-connecting-ip')})).success)return json({error:'Try again shortly.'},429);
 const login=await fetch(env.LEGACY_ORIGIN+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:env.LEGACY_ORIGIN},body:JSON.stringify({login:input.login,password:input.password})});
 if(!login.ok)return json({error:'The previous account could not be verified.'},401);
 const user:any=await login.json(),cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 if(!Number.isSafeInteger(user.userId)||!cookie)return json({error:'The previous account could not be verified.'},401);
 let imported=0,existing=0,failed=0;
 try{
  const response=await fetch(env.LEGACY_ORIGIN+'/api/boards',{headers:{cookie}});if(!response.ok)return json({error:'Previous boards are unavailable.'},502);
  const list:any=await response.json();if(!Array.isArray(list)||list.length>200)return json({error:'Download and import the boards individually.'},413);
  for(const summary of list){
   if(!Number.isSafeInteger(summary.id)){failed++;continue;}
   const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.LEGACY_ORIGIN+':'+user.userId+':'+summary.id))).slice(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
   const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
   const current=await env.WORK_ACCOUNTS.fetch(accountRequest(request,'/api/work/entries/'+id,identity,false,undefined,'GET'));if(current.ok){existing++;continue;}if(current.status!==404){failed++;continue;}
   const detail=await fetch(env.LEGACY_ORIGIN+'/api/boards/'+summary.id,{headers:{cookie}});if(!detail.ok){failed++;continue;}
   const board:any=await detail.json();const result=await save(id,{...board,expected_revision:0,legacy:{origin:env.LEGACY_ORIGIN,boardId:summary.id,createdAt:board.created_at,updatedAt:board.updated_at}});if(result.ok)imported++;else failed++;
  }
  return json({imported,existing,failed});
 }finally{await fetch(env.LEGACY_ORIGIN+'/api/auth/logout',{method:'POST',headers:{cookie,origin:env.LEGACY_ORIGIN}});}
}
