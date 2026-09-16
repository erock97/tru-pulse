/** Conservative USD inquiry estimates. Contact.price is deliberately never a fallback. */
export const VALUE_POLICY = 'inquiry-v1';
export interface InquiryEvent {
  id: number | string; type: string; created?: string; occurred?: string;
  property?: {price?: unknown; forRent?: unknown};
  paymentSignal?: boolean;
}
export interface InquiryEvidence {
  events: InquiryEvent[]; complete: boolean; checkedAt: string; receivedAt: string | null;
}
export type ValueStatus = 'included' | 'seller' | 'missing' | 'ambiguous' | 'rental' | 'incomplete' | 'historical' | 'unchecked';
export interface InquiryValue {
  status: ValueStatus; amount: number | null; eventId: string | null; eventAt: string | null;
  observedAmount: number | null;
  checkedAt: string | null; reason: string; policy: string;
}
export function inquiryValue(evidence?: InquiryEvidence, historicalOnly=false): InquiryValue {
  const base={amount:null,observedAmount:null,eventId:null,eventAt:null,checkedAt:evidence?.checkedAt || null,policy:VALUE_POLICY};
  const excluded=(status:ValueStatus,reason:string):InquiryValue=>({...base,status,reason});
  if(historicalOnly)return excluded('historical','Historical-only lead; current identity has not been refreshed.');
  if(!evidence)return excluded('unchecked','Inquiry evidence has not been checked.');
  if(!evidence.complete)return excluded('incomplete','Available event pages could not be fully retrieved.');
  const candidates=evidence.events.filter(e=>['Property Inquiry','Seller Inquiry','Inquiry','General Inquiry'].includes(e.type));
  if(!candidates.length)return excluded('missing','No accessible inquiry event.');
  const at=(e:InquiryEvent)=>Date.parse(e.occurred || e.created || '');
  if(candidates.some(e=>!Number.isFinite(at(e))))return excluded('ambiguous','An inquiry date is unavailable; original order cannot be established.');
  candidates.sort((a,b)=>at(a)-at(b));
  const first=candidates[0],received=Date.parse(evidence.receivedAt || '');
  if(!Number.isFinite(received)||Math.abs(at(first)-received)>300000)return excluded('incomplete','Earliest accessible inquiry is not within five minutes of lead creation.');
  const tied=candidates.filter(e=>at(e)===at(first));
  const signature=(e:InquiryEvent)=>JSON.stringify([e.type,e.property?.price,e.property?.forRent,e.paymentSignal]);
  if(new Set(tied.map(signature)).size>1)return excluded('ambiguous','Simultaneous first inquiries disagree; no amount was selected.');
  const raw=first.property?.price;
  const amount=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+(\.\d{1,2})?$/.test(raw.trim())?Number(raw):NaN;
  const proof={...base,observedAmount:Number.isFinite(amount)&&amount>0?amount:null,eventId:String(first.id),eventAt:new Date(at(first)).toISOString()};
  const result=(status:ValueStatus,reason:string,amount:number|null=null):InquiryValue=>({...proof,status,reason,amount});
  const rent=first.property?.forRent;
  if(rent===true||rent===1||rent==='1'||rent==='true')return result('rental','Inquiry property is marked for rent.');
  if(first.paymentSignal)return result('ambiguous','Inquiry includes a monthly-payment or mortgage-assessment signal.');
  if(!Number.isFinite(amount)||amount<=0)return result('missing','First inquiry has no usable property amount; later inquiries are not substituted.');
  // A review guard, never proof that the amount is a mortgage payment or rental.
  if(amount<25000||amount>100000000)return result('ambiguous','Property amount is outside the preview review range ($25,000–$100 million).');
  if(rent!==false&&rent!==0&&rent!=='0'&&rent!=='false')return result('ambiguous','Sale versus rental classification is unavailable.');
  if(first.type==='Seller Inquiry')return result('seller','Seller inquiry estimate, shown separately from buyer property volume.',amount);
  if(first.type!=='Property Inquiry')return result('ambiguous','First inquiry does not identify a property inquiry.');
  return result('included','Earliest available property inquiry near lead creation; not a verified purchase budget.',amount);
}
export function valueSummary(leads:Array<{key:string;historicalOnly?:boolean}>,values:Record<string,InquiryValue>){
  const rows=leads.map(l=>({key:l.key,value:values[l.key] || inquiryValue(undefined,l.historicalOnly)}));
  const buyer=rows.filter(r=>r.value.status==='included'),seller=rows.filter(r=>r.value.status==='seller');
  return {rows,total:rows.length,included:buyer.length,sellerCount:seller.length,
    amount:buyer.length?buyer.reduce((sum,r)=>sum+(r.value.amount || 0),0):null,
    sellerAmount:seller.length?seller.reduce((sum,r)=>sum+(r.value.amount || 0),0):null,
    unchecked:rows.filter(r=>r.value.status==='unchecked').length,
    excluded:rows.filter(r=>!['included','seller','unchecked'].includes(r.value.status)).length};
}
