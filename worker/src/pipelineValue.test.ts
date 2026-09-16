import {it,expect} from 'vitest';
import {inquiryValue,valueSummary,type InquiryEvent,type InquiryEvidence} from '../../shared/pipelineValue';
const date='2026-09-01T12:00:00Z';
const event=(price:unknown=289900,over:Partial<InquiryEvent>={}):InquiryEvent=>({id:1,type:'Property Inquiry',created:date,property:{price,forRent:0},...over});
const evidence=(events:InquiryEvent[]=[event()],over:Partial<InquiryEvidence>={}):InquiryEvidence=>({events,complete:true,receivedAt:date,checkedAt:date,...over});
it('uses the first inquiry, never a later more expensive property',()=>{
 expect(inquiryValue(evidence([event(999000,{id:2,created:'2026-09-02T12:00:00Z'}),event('289900')]))).toMatchObject({status:'included',amount:289900,eventId:'1'});
 expect(inquiryValue(evidence([event(null),event(999000,{id:2,created:'2026-09-02T12:00:00Z'})])).status).toBe('missing');
});
it('excludes ambiguous low values, rentals, unknown rental state and payment signals',()=>{
 for(const e of [event(3000),event(500000,{property:{price:500000,forRent:1}}),event(500000,{property:{price:500000}}),event(500000,{paymentSignal:true})])expect(inquiryValue(evidence([e])).amount).toBeNull();
 expect(inquiryValue(evidence([event(3000)])).reason).not.toContain('is a mortgage');
});
it('keeps seller estimates separate and never fills missing coverage',()=>{
 const values={a:inquiryValue(evidence()),b:inquiryValue(evidence([event(628000,{type:'Seller Inquiry'})]))};
 expect(valueSummary([{key:'a'},{key:'b'},{key:'c'}],values)).toMatchObject({amount:289900,included:1,sellerAmount:628000,sellerCount:1,unchecked:1,total:3});
 expect(valueSummary([{key:'c'}],{}).amount).toBeNull();
});
it('fails closed for incomplete history, undated events, conflicting ties and distant inquiries',()=>{
 expect(inquiryValue(evidence([], {complete:false})).status).toBe('incomplete');
 expect(inquiryValue(evidence([event(100000,{created:undefined})])).status).toBe('ambiguous');
 expect(inquiryValue(evidence([event(100000),event(200000,{id:2})])).status).toBe('ambiguous');
 expect(inquiryValue(evidence([event(100000,{created:'2026-09-02T12:00:00Z'})])).status).toBe('incomplete');
 expect(inquiryValue(evidence(),true).status).toBe('historical');
});
it('rejects malformed and unsafe amounts and uses occurred for original event timing',()=>{
 for(const price of [true,{},'1e6','USD 500000',Infinity,-1,100000001])expect(inquiryValue(evidence([event(price)])).amount).toBeNull();
 expect(inquiryValue(evidence([event(300000,{created:'2026-09-02T12:00:00Z',occurred:date})])).amount).toBe(300000);
});
