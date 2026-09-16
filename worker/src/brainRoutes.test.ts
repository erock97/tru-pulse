import {describe,it,expect,vi} from 'vitest';
import {handleBrainRoute} from './brainRoutes.js';
import type {Env} from './env.js';
const setup=()=>({TRUEBRAIN_OWNER_ID:'owner',TRUEBRAIN_GATEWAY_TOKEN:'server-only',TRUEBRAIN:{fetch:vi.fn(async()=>Response.json({tasks:[]}))}} as unknown as Env);
describe('private TrueBrain gateway',()=>{
 it('rejects other admins and impersonation without contacting Brain',async()=>{const env=setup();expect((await handleBrainRoute(new Request('https://api/admin/brain'),env,'other',false)).status).toBe(403);expect((await handleBrainRoute(new Request('https://api/admin/brain'),env,'owner',true)).status).toBe(403);expect(env.TRUEBRAIN!.fetch).not.toHaveBeenCalled();});
 it('does not expose gateway credentials',async()=>{const env=setup();const response=await handleBrainRoute(new Request('https://api/admin/brain'),env,'owner',false);expect(response.status).toBe(200);expect(await response.text()).not.toContain('server-only');});
 it('rejects cross-origin mutations',async()=>{const env=setup();const response=await handleBrainRoute(new Request('https://api/admin/brain/control',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),env,'owner',false);expect(response.status).toBe(403);});
 it('only forwards the explicit dashboard routes',async()=>{const env=setup();expect((await handleBrainRoute(new Request('https://api/admin/brain/../brain/release'),env,'owner',false)).status).toBe(404);});
});
