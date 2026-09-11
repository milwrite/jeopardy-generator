type Model = {id:string;provider?:string;status?:string;capabilities?:string[]};
type Gateway = {fetch(request:Request):Promise<Response>};
const caches = new WeakMap<Gateway,{at:number;models:Model[]}>();

export async function resolveGatewayModel(gateway:Gateway,selected:string,signal:AbortSignal):Promise<string|null>{
  let cached=caches.get(gateway);
  if(!cached || Date.now()-cached.at>300_000){
    const response=await gateway.fetch(new Request('https://tools.ailab.gc.cuny.edu/v1/catalog',{
      signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),
    }));
    if(!response.ok)throw new Error('The model list is temporarily unavailable.');
    const data=await response.json() as {data?:Model[]};
    if(!Array.isArray(data.data)||!data.data.length)throw new Error('The model list is temporarily unavailable.');
    cached={at:Date.now(),models:data.data};caches.set(gateway,cached);
  }
  // Workers AI's full binding id and CAIL's public alias are different contracts.
  // Keep saved browser choices, but send the id advertised by the live gateway.
  return cached.models.find(m=>(m.status??'active')==='active'
    && (m.capabilities??['text-generation']).includes('text-generation')
    && (m.id===selected || m.provider==='workers-ai' && selected.startsWith('@cf/') && m.id===selected.split('/').slice(2).join('/')))?.id??null;
}
