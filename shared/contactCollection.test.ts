import {describe,it,expect} from 'vitest';
import {normalizeContactTimeline} from './contactCollection.js';
const row=()=>({id:'InboxAppMessage:1',personId:1,type:'InboxAppMessage',item:{sentAt:'2026-08-03T00:02:00Z',isIncoming:false,createdById:7,sender:{userId:7},participants:[{userId:7,isAutomation:false}],inboxApp:{name:'Zillow Messages'},deliveryStatus:'Delivered'}});
describe('Zillow timeline collection',()=>{
 it('retains sender, sent time, channel and delivery',()=>{const [e]=normalizeContactTimeline([row()],'1');expect(e).toMatchObject({channel:'zillow_message',agentId:'7',personal:true,timeVerified:true,deliveryStatus:'Delivered'});});
 it('does not credit automation or ambiguous initiation',()=>{const a=row();a.item.participants[0].isAutomation=true;expect(normalizeContactTimeline([a],'1')[0].personal).toBe(false);const b=row();b.item.createdById=-1;expect(normalizeContactTimeline([b],'1')[0].personal).toBeNull();});
 it('retains failed delivery rather than silently dropping an attempted response',()=>{const r=row();r.item.deliveryStatus='Not Delivered';expect(normalizeContactTimeline([r],'1')[0].deliveryStatus).toBe('Not Delivered');});
 it('rejects foreign, duplicate and unknown-channel records',()=>{expect(()=>normalizeContactTimeline([row()],'2')).toThrow();expect(()=>normalizeContactTimeline([row(),row()],'1')).toThrow();const r=row();r.item.inboxApp.name='Other';expect(()=>normalizeContactTimeline([r],'1')).toThrow();});
 it('does not invent a timestamp for manual calls',()=>{expect(normalizeContactTimeline([{id:'Call:1',personId:1,type:'Call',item:{isIncoming:false,userId:7,created:'2026-08-03T00:02:00Z'}}],'1')[0]).toMatchObject({at:null,timeVerified:false,personal:null});});
});
