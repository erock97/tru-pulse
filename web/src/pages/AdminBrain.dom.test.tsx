// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {it,expect,vi,afterEach} from 'vitest';
import {AdminBrain} from './AdminBrain';
import {workerFetch} from '../lib/api';
vi.mock('../lib/api',()=>({workerFetch:vi.fn(),signOutClean:vi.fn()}));
vi.mock('../components/hqShell',()=>({HqShell:({children}:{children:React.ReactNode})=><>{children}</>}));
let root:Root|undefined,host:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('removes previously loaded private data when the browser session loses owner access',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();
 const snapshot={tasks:[],workers:[],projects:[],memory:[],mail:[],paused:true,intakeEnabled:false,activationReady:false,connections:{},alerts:[{id:'a',kind:'scope',title:'Private owner question',body:'Private context',created_at:'2026-09-16T10:00:00Z'}]};
 vi.mocked(workerFetch).mockResolvedValueOnce(new Response(JSON.stringify(snapshot))).mockResolvedValue(new Response(JSON.stringify({error:'forbidden'}),{status:403}));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<AdminBrain onOpenPulse={()=>{}} onOpenCoach={()=>{}} onOpenRep={()=>{}}/>));
 expect(host.textContent).toContain('Private owner question');
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(host.textContent).not.toContain('Private owner question');expect(host.textContent).not.toContain('Private context');expect(host.textContent).toContain('requires your owner session');
});
