import type {Env} from './env.js';
import {getSecret} from './infisical.js';

const TAGS:Record<string,string>={compass627:'COSTIGAN',signaturerealtynj28:'SIGNATURE',themooregroupe:'SCOTTMOORE',sbrealty:'SATISH',elnewhome:'SYNERGY',woosleygroup:'WOOSLEY'};
type Cookie={name:string;value:string;domain:string;path:string;hostOnly:boolean};
/** A session belongs to one account. Never forward cookies or credentials to arbitrary redirects. */
export class FubTimelineSession {
 private cookies:Cookie[]=[];
 constructor(private account:string,private request:typeof fetch=fetch){if(!/^[a-z0-9-]+$/.test(account))throw Error('Invalid FUB account');}
 private async visit(url:string,init:RequestInit={}):Promise<Response>{
  const u=new URL(url);
  if(u.protocol!=='https:'||u.port||!['login.followupboss.com',this.account+'.followupboss.com'].includes(u.hostname))throw Error('Unexpected FUB destination');
  const cookie=this.cookies.filter(c=>(c.hostOnly?u.hostname===c.domain:u.hostname===c.domain||u.hostname.endsWith('.'+c.domain))&&u.pathname.startsWith(c.path)).map(c=>c.name+'='+c.value).join('; ');
  const headers=new Headers(init.headers);if(cookie)headers.set('Cookie',cookie);
  const r=await this.request(u.href,{...init,headers,redirect:'manual',signal:AbortSignal.timeout(20000)});
  const responseHeaders=r.headers as unknown as {getSetCookie?:()=>string[];getAll:(name:string)=>string[]};
  for(const raw of responseHeaders.getSetCookie?responseHeaders.getSetCookie():responseHeaders.getAll('Set-Cookie')){
   const [pair,...attrs]=raw.split(';');const eq=pair.indexOf('=');if(eq<1)continue;
   const options=new Map(attrs.map(a=>{const [k,...v]=a.trim().split('=');return [k.toLowerCase(),v.join('=')];}));
   const domain=(options.get('domain')||u.hostname).replace(/^\./,'').toLowerCase();
   if(!(u.hostname===domain||u.hostname.endsWith('.'+domain))||!(domain==='followupboss.com'||domain.endsWith('.followupboss.com')))continue;
   const c={name:pair.slice(0,eq),value:pair.slice(eq+1),domain,path:options.get('path')||'/',hostOnly:!options.has('domain')};
   this.cookies=this.cookies.filter(old=>!(old.name===c.name&&old.domain===c.domain&&old.path===c.path));
   if(options.get('max-age')!=='0')this.cookies.push(c);
  }
  return r;
 }
 async login(env:Env){
  const tag=TAGS[this.account];if(!tag)throw Error('FUB account login is not configured');
  const [email,password]=await Promise.all([getSecret(env,'FUB_USER_'+tag,'/fub-logins'),getSecret(env,'FUB_PASS_'+tag,'/fub-logins')]);
  if(!email||!password)throw Error('FUB login credentials unavailable');
  const page=await this.visit('https://login.followupboss.com/login?subdomain='+this.account);
  if(!page.ok)throw Error('FUB login page unavailable');
  const csrf=(await page.text()).match(/fubcsrf_[a-zA-Z0-9]+/)?.[0];if(!csrf)throw Error('FUB login token unavailable');
  let r=await this.visit('https://login.followupboss.com/login/index',{method:'POST',body:new URLSearchParams({email,password,subdomain:this.account,start_url:'',remember:'0',csrf_token:csrf})});
  for(let n=0;n<8&&r.status>=300&&r.status<400;n++){
   const location=r.headers.get('Location');if(!location)throw Error('FUB login redirect missing');
   const next=new URL(location,r.url||'https://login.followupboss.com/login/index').href;
   await r.body?.cancel();r=await this.visit(next);
  }
  if(!r.ok)throw Error('FUB login failed');await r.body?.cancel();
 }
 async json(path:string):Promise<any>{
  const u=new URL(path,'https://'+this.account+'.followupboss.com');
  if(u.hostname!==this.account+'.followupboss.com'||!u.pathname.startsWith('/api/v1/'))throw Error('Invalid FUB API destination');
  const r=await this.visit(u.href,{headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest','X-System':'fub-spa'}});
  if(!r.ok)throw Error('FUB timeline request failed ('+r.status+')');
  try{return await r.json();}catch{throw Error('FUB session expired or returned invalid data');}
 }
 async timeline(personId:string):Promise<any[]>{
  if(!/^\d+$/.test(personId))throw Error('Invalid person identity');
  let next='/api/v1/timeline?personId='+personId+'&limit=100';const seen=new Set<string>(),ids=new Set<string>(),rows:any[]=[];
  for(let page=0;page<100;page++){
   const u=new URL(next,'https://'+this.account+'.followupboss.com');
   if(u.pathname!=='/api/v1/timeline'||u.searchParams.get('personId')!==personId||seen.has(u.href))throw Error('Invalid timeline pagination');seen.add(u.href);
   const data=await this.json(u.href);
   if(!Array.isArray(data.timeline)||!Number.isInteger(data._metadata?.total))throw Error('Timeline coverage missing');
   for(const row of data.timeline){if(String(row.personId)!==personId||!row.id||ids.has(String(row.id)))throw Error('Timeline identity mismatch');ids.add(String(row.id));rows.push(row);}
   next=data._metadata.nextLink;
   if(!next){if(rows.length!==data._metadata.total)throw Error('Incomplete timeline');return rows;}
  }
  throw Error('Timeline pagination limit reached');
 }
}
