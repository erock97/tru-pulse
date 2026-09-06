import {it,expect,vi} from 'vitest';
import worker from './index.js';
import type {Env} from './env.js';
it('requires the admin token before reading publisher health',async()=>{
  const dashboard=vi.fn();
  const env={ADMIN_TOKEN:'private',WEEKLY_REPORTS:{dashboard},SUPABASE_URL:'https://example.supabase.co'} as unknown as Env;
  const response=await worker.fetch(new Request('https://api.truhq.co/admin/hustle-status'),env,{} as ExecutionContext);
  expect(response.status).toBe(401);expect(dashboard).not.toHaveBeenCalled();
});
it('returns only publication metadata, never individual scores',async()=>{
  const dashboard=vi.fn().mockResolvedValue({teams:[{id:'costigan',hustle:{latest:{weekEnding:'2026-09-04',capturedAt:'2026-09-04T12:00:00Z',runStatus:'FINALIZED',deliveryStatus:'SENT',agents:[{agent:'Private agent',score:80}]}}}]});
  const env={ADMIN_TOKEN:'private',WEEKLY_REPORTS:{dashboard},SUPABASE_URL:'https://example.supabase.co'} as unknown as Env;
  const response=await worker.fetch(new Request('https://api.truhq.co/admin/hustle-status',{headers:{'x-admin-token':'private'}}),env,{} as ExecutionContext);
  expect(response.status).toBe(200);const text=await response.text();
  expect(text).toContain('agentCount');expect(text).not.toContain('Private agent');expect(text).not.toContain('score');
});
