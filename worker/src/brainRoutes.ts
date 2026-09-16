import type { Env } from './env.js';

/** Called only after the existing verified-user/admin checks. */
export async function handleBrainRoute(req: Request, env: Env, userId: string, impersonating: boolean): Promise<Response> {
  const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(impersonating) return respond({error:'TrueBrain is unavailable while acting as a team'},403);
  if(!env.TRUEBRAIN_OWNER_ID || userId!==env.TRUEBRAIN_OWNER_ID) return respond({error:'TrueBrain is private to its owner'},403);
  if(req.method==='GET' && new URL(req.url).pathname==='/admin/brain/access') return respond({owner:true});
  if(!env.TRUEBRAIN || !env.TRUEBRAIN_GATEWAY_TOKEN) return respond({error:'TrueBrain connection is not configured'},503);
  const url=new URL(req.url), path=url.pathname.slice('/admin/brain'.length);
  const routes:Record<string,string>={'':'dashboard','/control':'control','/events':'events','/context':'context'};
  const target=routes[path];
  if(!target || !['GET','POST'].includes(req.method) || (req.method==='POST')!==(target==='control')) return respond({error:'Not found'},404);
  if(req.method==='POST' && req.headers.get('origin')!==new URL(env.APP_ORIGIN || 'https://app.truhq.co').origin) return respond({error:'Invalid request origin'},403);
  const body=req.method==='POST'?await req.text():undefined;
  if(body && body.length>64000) return respond({error:'Request too large'},413);
  try {
    const response=await env.TRUEBRAIN.fetch(new Request(`https://truebrain.internal/v1/${target}${url.search}`,{method:req.method,headers:{Authorization:`Bearer ${env.TRUEBRAIN_GATEWAY_TOKEN}`,'Content-Type':'application/json'},body}));
    return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  } catch {return respond({error:'TrueBrain is temporarily unavailable'},502);}
}
