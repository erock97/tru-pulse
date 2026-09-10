import {it,expect,vi} from 'vitest';
import {observedContactFlag} from '../../shared/contactEvidence.js';
import {reconcileTeam} from './accountability.js';
import {buildBrief} from './brief.js';
it('makes cached negative and absent evidence unknown, without rewriting positive observations',()=>{
 expect(observedContactFlag('zero_contact')).toBe('unknown');expect(observedContactFlag(null)).toBe('unknown');
 expect(observedContactFlag('worked')).toBe('worked');expect(observedContactFlag('stuck')).toBe('stuck');
});
it('holds strikes and resolutions without reading or mutating the existing case ledger',async()=>{
 const db=new Proxy({}, {get(){throw Error('No case decisions while evidence is incomplete');}});
 expect(await reconcileTeam(db as any,{id:'team',org_id:'org'})).toMatchObject({complied:0,opened:0,pauseRecs:0,state:'held'});
});
it('does not generate pause advice or claim everybody worked from unavailable evidence',async()=>{
 const select=vi.fn();const r=await buildBrief({select} as any,{id:'org',name:'Test'});
 expect(r.hasContent).toBe(false);expect(r.html).toContain('coverage is incomplete');expect(select).not.toHaveBeenCalled();
});
