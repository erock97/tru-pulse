import {describe,it,expect} from 'vitest';
import {hustleFeed,type WeeklyDashboard} from './hustleFeed.js';
const fixture=():WeeklyDashboard=>({teams:[{id:'costigan',hustle:{latest:{
  weekEnding:'2026-09-04',capturedAt:'2026-09-04T12:00:00Z',deliveryStatus:'SENT',runStatus:'FINALIZED',
  agents:[{agent:'Test Agent',score:73,action:'Maintain',recentConnections:20,recentConverted:2,earlierConnections:40,earlierConverted:3,offers:4}],
}}},{id:'signature',hustle:{latest:null}}]});
describe('original Hustle feed',()=>{
  it('returns only the requested team and preserves original score',()=>{
    const result=hustleFeed(fixture(),'costigan',[{id:'a',name:'Test Agent'}]);
    expect(result.scores).toHaveLength(1);expect(result.scores[0]).toMatchObject({agent_id:'a',final_score:73,ranking_eligible:null});
    expect(hustleFeed(fixture(),'signature',[]).scores).toEqual([]);
    expect(hustleFeed(fixture(),'missing',[]).scores).toEqual([]);
  });
  it('does not expose bundled previews as published data',()=>{
    const data=fixture();data.teams[0].hustle.latest!.deliveryStatus='PREVIEW_VERIFIED';
    expect(hustleFeed(data,'costigan',[]).scores).toEqual([]);
  });
  it('withholds failed or active runs even when delivery was accepted',()=>{
    for(const status of ['WITHHELD_FINAL','WITHHELD_VALIDATION','ACTIVE','AUTH_REQUIRED']) {
      const data=fixture();data.teams[0].hustle.latest!.runStatus=status;
      data.teams[0].hustle.latest!.deliveryStatus='PROVIDER_ACCEPTED';
      expect(hustleFeed(data,'costigan',[]).scores).toEqual([]);
    }
  });
  it('does not guess ambiguous roster identity or accept invalid scores',()=>{
    const data=fixture();
    expect(hustleFeed(data,'costigan',[{id:'a',name:'Test Agent'},{id:'b',name:'Test Agent'}]).scores[0].agent_id).toBeNull();
    data.teams[0].hustle.latest!.agents[0].score=101;
    expect(()=>hustleFeed(data,'costigan',[])).toThrow('Invalid published score');
  });
});
