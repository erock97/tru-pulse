import type {Env} from './env.js';

export const TIMELINE_DISABLED = 'FUB_TIMELINE_LOGIN_DISABLED_20260910';
/** Retired compatibility surface. No credentials, cookies or network requests. */
export class FubTimelineSession {
 constructor(_account:string,_request?:typeof fetch){}
 async login(_env:Env):Promise<void>{throw Error(TIMELINE_DISABLED);}
 async json(_path:string):Promise<any>{throw Error(TIMELINE_DISABLED);}
 async timeline(_personId:string):Promise<any[]>{throw Error(TIMELINE_DISABLED);}
}
