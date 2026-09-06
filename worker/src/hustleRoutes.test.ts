import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDataRoutes } from './dataRoutes.js';
import { supabaseAsUser } from './asUser.js';
import type { Env } from './env.js';
vi.mock('./asUser.js',()=>({supabaseAsUser:vi.fn()}));
const select=vi.fn();
const org='11111111-1111-1111-1111-111111111111';
const call=(id=org)=>{const url=new URL(`https://api.example/data/hustle?orgId=${encodeURIComponent(id)}`);return handleDataRoutes(new Request(url),{} as Env,url,{});};
describe('weekly Hustle reader',()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.mocked(supabaseAsUser).mockResolvedValue({select} as unknown as Awaited<ReturnType<typeof supabaseAsUser>>);});
  it('requires authentication',async()=>{vi.mocked(supabaseAsUser).mockResolvedValue(null);expect((await call())?.status).toBe(401);expect(select).not.toHaveBeenCalled();});
  it('rejects filter injection',async()=>{expect((await call('bad&org_id=neq.any'))?.status).toBe(400);expect(select).not.toHaveBeenCalled();});
  it('never calls the privileged report service without membership',async()=>{
    const dashboard=vi.fn();select.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const url=new URL(`https://api.example/data/hustle?orgId=${org}`);
    const response=await handleDataRoutes(new Request(url),{WEEKLY_REPORTS:{dashboard}} as unknown as Env,url,{});
    expect(response?.status).toBe(403);expect(dashboard).not.toHaveBeenCalled();
  });
  it('distinguishes no publication from a failed source',async()=>{select.mockResolvedValueOnce([]);expect(await (await call())?.json()).toEqual({weekEnding:null,scores:[]});select.mockRejectedValueOnce(new Error('unavailable'));expect((await call())?.status).toBe(502);});
  it('scopes both queries to the organization and latest week without dropping unmatched agents',async()=>{
    const row={id:'report-row',agent_id:null,agent_name:'Unmatched',final_score:null};
    select.mockResolvedValueOnce([{week_ending:'2026-09-04'}]).mockResolvedValueOnce([row]);
    expect(await (await call())?.json()).toEqual({weekEnding:'2026-09-04',scores:[row]});
    for(const args of select.mock.calls){expect(args[0]).toBe('hustle_weekly_scores');expect(args[1]).toContain(`org_id=eq.${org}`);expect(args[2]).toEqual({strict:true});}
    expect(select.mock.calls[1][1]).toContain('week_ending=eq.2026-09-04');
  });
});
