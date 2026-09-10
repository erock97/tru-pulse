import {describe,it,expect,vi} from 'vitest';
import {FubTimelineSession,TIMELINE_DISABLED} from './fubTimeline.js';

describe('retired FUB web session',()=>{
 it.each(['compass627','signaturerealtynj28','themooregroupe','sbrealty','elnewhome','woosleygroup'])('blocks every entry point without credentials or network: %s',async(account)=>{
  const request=vi.fn();
  const env=new Proxy({}, {get(){throw Error('Must not access credentials');}});
  const session=new FubTimelineSession(account,request);
  await expect(session.login(env as any)).rejects.toThrow(TIMELINE_DISABLED);
  await expect(session.json('/api/v1/people/123')).rejects.toThrow(TIMELINE_DISABLED);
  await expect(session.timeline('123')).rejects.toThrow(TIMELINE_DISABLED);
  expect(request).not.toHaveBeenCalled();
 });
});
