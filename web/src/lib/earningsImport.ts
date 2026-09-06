import { parseCSV } from './csv';
export const earningsFields=['deal_id','agent','closed_date','gross_commission','referral_fee','broker_share_pct','expenses','source'] as const;
export type EarningsField=typeof earningsFields[number];
export type EarningsRow={id:string;agent:string;date:string;gross:number;referral:number;share:number;expenses:number|null;source:string;line:number};
export function amount(raw:string):number|null { const s=raw.trim().replace(/[$,]/g,''); return /^(\d+)(\.\d{1,2})?$/.test(s)&&Number.isFinite(Number(s))?Number(s):null; }
export function strictDate(s:string):boolean { if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s; }
export function reviewEarnings(text:string,mapping:Record<EarningsField,string>,defaultShare:string) {
  const csv=parseCSV(text);const rows:EarningsRow[]=[];const errors:string[]=[];const ids=new Set<string>();
  if(!csv||!csv.rows.length)return {rows,errors:['No data rows found.']};
  if((text.match(/"/g)?.length??0)%2)return {rows,errors:['Unclosed quoted field.']};
  if(new Set(csv.headers).size!==csv.headers.length)return {rows,errors:['Duplicate column headers.']};
  const required:EarningsField[]=['deal_id','agent','closed_date','gross_commission','referral_fee'];
  if(required.some(k=>!mapping[k]||!csv.headers.includes(mapping[k])))return {rows,errors:['Map deal ID, agent, closed date, gross commission and referral fee.']};
  csv.rows.forEach((r,i)=>{
    const get=(k:EarningsField)=>(r[csv.headers.indexOf(mapping[k])]??'').trim();const id=get('deal_id');const date=get('closed_date');
    const gross=amount(get('gross_commission')),referral=amount(get('referral_fee')),share=amount(get('broker_share_pct')||defaultShare),expenses=get('expenses')?amount(get('expenses')):null;
    if(r.length!==csv.headers.length||!id||ids.has(id)||!get('agent')||!strictDate(date)||gross===null||referral===null||referral>gross||share===null||share>100||(get('expenses')&&expenses===null)){errors.push(`Row ${i+2}: check duplicate ID, required fields, ISO date, amounts and percentage (0–100).`);return;}
    ids.add(id);rows.push({id,agent:get('agent'),date,gross,referral,share,expenses,source:get('source')||'Unspecified',line:i+2});
  });return {rows,errors};
}
export function earnings(row:EarningsRow) { const retained=Math.round((row.gross-row.referral)*row.share)/100;return {retained,contribution:row.expenses===null?null:Math.round((retained-row.expenses)*100)/100}; }
export function csvCell(value:unknown) {let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
