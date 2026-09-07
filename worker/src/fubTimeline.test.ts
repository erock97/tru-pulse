import {it,expect,vi} from 'vitest';
import {FubTimelineSession} from './fubTimeline.js';
const response=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
it('checks every page and rejects foreign pagination without sending credentials',async()=>{
 const fetcher=vi.fn().mockResolvedValue(response({timeline:[],_metadata:{total:1,nextLink:'https://other.followupboss.com/api/v1/timeline?personId=1'}}));
 const s=new FubTimelineSession('compass627',fetcher);await expect(s.timeline('1')).rejects.toThrow('Invalid FUB API destination');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not publish a truncated or foreign contact timeline',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({timeline:[],_metadata:{total:1}})).mockResolvedValueOnce(response({timeline:[{id:'x',personId:2}],_metadata:{total:1}}));
 const s=new FubTimelineSession('compass627',fetcher);await expect(s.timeline('1')).rejects.toThrow('Incomplete timeline');await expect(s.timeline('1')).rejects.toThrow('identity mismatch');
});
it('collects all pages exactly once',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({timeline:[{id:'a',personId:1}],_metadata:{total:2,nextLink:'https://compass627.followupboss.com/api/v1/timeline?personId=1&offset=1'}})).mockResolvedValueOnce(response({timeline:[{id:'b',personId:1}],_metadata:{total:2}}));
 expect(await new FubTimelineSession('compass627',fetcher).timeline('1')).toHaveLength(2);expect(fetcher).toHaveBeenCalledTimes(2);
});

it('calls the native fetch function without binding it to the session object',async()=>{
 const fetcher=function(this:unknown){expect(this).toBeUndefined();return Promise.resolve(response({timeline:[],_metadata:{total:0}}));};
 expect(await new FubTimelineSession('compass627',fetcher as any).timeline('1')).toEqual([]);
});
