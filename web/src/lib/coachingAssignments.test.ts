import {beforeEach,it,expect,vi} from 'vitest';
import {workerFetch} from './api';
import {loadAssignments,saveAssignment} from './coachingAssignments';
vi.mock('./api',()=>({isDemo:false,workerFetch:vi.fn()}));
beforeEach(()=>vi.resetAllMocks());
it('uses the authenticated worker with an encoded agent identifier',async()=>{vi.mocked(workerFetch).mockResolvedValue(new Response(JSON.stringify({assignments:[],canAssign:false})));expect(await loadAssignments('agent&other=1')).toEqual({assignments:[],canAssign:false});expect(workerFetch).toHaveBeenCalledWith('/data/coaching-assignments?agentId=agent%26other%3D1');});
it('does not display unavailable work as an empty list',async()=>{vi.mocked(workerFetch).mockResolvedValue(new Response('{}',{status:503}));await expect(loadAssignments('agent')).rejects.toThrow('could not be loaded');});
it('returns only a confirmed save patch',async()=>{vi.mocked(workerFetch).mockResolvedValue(new Response(JSON.stringify({ok:true,patch:{reflection:'Practiced twice'}})));expect(await saveAssignment('agent',{id:'id',action:'practice',reflection:'Practiced twice'})).toMatchObject({patch:{reflection:'Practiced twice'}});expect(workerFetch).toHaveBeenCalledWith('/data/coaching-assignments?agentId=agent',expect.objectContaining({method:'POST'}));});
it('surfaces denied or ambiguous saves instead of reporting success',async()=>{vi.mocked(workerFetch).mockResolvedValueOnce(new Response(JSON.stringify({error:'Only coaches can review work'}),{status:403})).mockResolvedValueOnce(new Response('{"ok":true}'));await expect(saveAssignment('agent',{action:'review'})).rejects.toThrow('Only coaches');await expect(saveAssignment('agent',{action:'practice'})).rejects.toThrow('did not confirm');});
