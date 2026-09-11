type Model = {id:string;provider?:string;status?:string;capabilities?:string[]};
type Gateway = {fetch(request:Request):Promise<Response>};
const caches = new WeakMap<Gateway,{at:number;models:Model[]}>();

export async function gameCatalog(gateway:Gateway,signal:AbortSignal){
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
  return GAME_MODELS.filter(choice => cached!.models.some(m =>
    m.id === choice.id && m.provider === choice.provider && (m.status??'active') === 'active'
    && (m.capabilities??[]).includes('text-generation')));
}

export async function resolveGatewayModel(gateway:Gateway,selected:string,signal:AbortSignal):Promise<string|null>{
  const choice=gameModel(selected);
  if(!choice)return null;
  return (await gameCatalog(gateway,signal)).find(m=>m.id===choice.id)?.id??null;
}
import { GAME_MODELS, gameModel } from '../src/gameModels';
