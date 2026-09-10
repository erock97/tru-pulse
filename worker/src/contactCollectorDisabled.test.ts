import {describe,it,expect,vi} from 'vitest';
const orgId='aaaaaaaa-1111-4111-8111-111111111111';
vi.mock('./asUser.js',()=>({supabaseAsUser:async()=>({userId:'user',select:async(table:string)=>table==='memberships'?[{org_id:orgId}]:[{id:'team'}]})}));
import {handleDataRoutes} from './dataRoutes.js';
describe('disabled collector dashboard fallback',()=>{
 it('does not promote a stored collector snapshot into a current report',async()=>{
  const url=new URL('https://api.truhq.co/data/contact-speed?orgId='+orgId);
  const env={SESSIONS:{get:async()=>null},TIMELINES:{idFromName:()=>'',get:()=>({fetch:async()=>Response.json({snapshot:{invalid:'must not be interpreted'},health:{state:'disabled'}})})}};
  const result=await handleDataRoutes(new Request(url),env as any,url,{});
  expect(result?.status).toBe(200);
  expect(await result!.json()).toEqual({report:null,collection:[{teamId:'team',state:'disabled'}]});
 });
});
