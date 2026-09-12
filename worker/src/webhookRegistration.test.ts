import {it,expect,vi,afterEach} from 'vitest';
import {registerWebhooks,FUB_WEBHOOK_EVENTS} from './fub.js';
afterEach(()=>vi.unstubAllGlobals());
const target='https://api.truhq.co/webhook/fub?team=team&key=token';
const hooks=()=>FUB_WEBHOOK_EVENTS.map((event,id)=>({id,event,status:'Active',url:target.replace('api.truhq.co','tru-pulse-sync.eric-b3c.workers.dev')}));
it('keeps healthy legacy callbacks without any registration writes',async()=>{
 const fetch=vi.fn(async()=>Response.json({webhooks:hooks(),_metadata:{total:5}}));vi.stubGlobal('fetch',fetch);
 const results=await registerWebhooks('key',target,'system','TruPulse');expect(results).toHaveLength(5);expect(fetch).toHaveBeenCalledTimes(1);
});
it('repairs only a disabled registration and preserves its URL',async()=>{
 const existing=hooks();existing[2].status='Disabled';
 const fetch=vi.fn(async(_url:string,init:any)=>init?.method==='DELETE'?new Response(null,{status:204}):init?.method==='POST'?Response.json({id:9},{status:201}):Response.json({webhooks:existing}));vi.stubGlobal('fetch',fetch);
 await registerWebhooks('key',target,'system','TruPulse');expect(fetch).toHaveBeenCalledTimes(3);
 expect(JSON.parse(fetch.mock.calls[2][1].body).url).toBe(existing[2].url);
});
it('does not write after an incomplete registration inventory',async()=>{
 const fetch=vi.fn(async()=>Response.json({webhooks:[],_metadata:{total:5}}));vi.stubGlobal('fetch',fetch);
 expect((await registerWebhooks('key',target))[0].status).toBe(502);expect(fetch).toHaveBeenCalledTimes(1);
});
