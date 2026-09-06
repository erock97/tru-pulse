import { useEffect, useState } from 'react';
import { isDemo, workerFetch } from '../lib/api';
import './hustlePanel.css';

interface Score {
  id: string; agent_id: string | null; agent_name: string; week_ending: string;
  final_score: number | null; evidence_label: string | null; eligibility: string | null;
  ranking_eligible: boolean | null; offers_recent: number | null; broker_action: string | null;
  action_reason: string | null; captured_at: string | null;
}
interface Report { weekEnding: string | null; scores: Score[] }
const dateLabel = (value: string) => new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});

export function HustlePanel({orgId}:{orgId:string}) {
  const [report,setReport] = useState<Report|null>(null);
  const [error,setError] = useState('');
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    let active=true; setReport(null); setError('');
    async function load() {
      if(isDemo) return {weekEnding:null,scores:[]} as Report;
      const response=await workerFetch(`/data/hustle?orgId=${encodeURIComponent(orgId)}`);
      if(!response.ok) throw new Error('Weekly Hustle is unavailable. Your scores have not been changed.');
      return await response.json() as Report;
    }
    load().then(data=>{if(active)setReport(data);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[orgId,attempt]);
  return <section className="hustle-panel" aria-labelledby="hustle-heading">
    <header><div><p className="hustle-eyebrow">Weekly report</p><h2 id="hustle-heading">Weekly Hustle</h2></div>
      {report?.weekEnding&&<span>Week ending {dateLabel(report.weekEnding)}</span>}</header>
    <p className="hustle-intro">The score and reasoning from your published weekly report. This report uses its own weekly windows, independently of the lead-period filter.</p>
    {report?.weekEnding && Date.now()-Date.parse(`${report.weekEnding}T23:59:59Z`)>14*86400000 && <p role="status">This is an older report, not this week’s performance. Use the date above when reviewing its recommendations.</p>}
    {error?<div role="alert"><p>{error}</p><button onClick={()=>setAttempt(x=>x+1)}>Retry report</button></div>:!report?<p role="status">Loading weekly report…</p>:!report.scores.length?
      <div className="hustle-empty"><h3>{isDemo?'Your weekly report belongs here.':'No weekly report published yet.'}</h3><p>{isDemo?'The preview does not invent agent scores. Published scores will appear here once the weekly report feed is connected.':'When the weekly publisher delivers this team’s report, the scores and their explanations will appear here. No report does not mean a zero score.'}</p></div>:
      <div className="operations-table"><table><thead><tr><th scope="col">Agent</th><th scope="col">Hustle score</th><th scope="col">Report recommendation</th><th scope="col">Explanation</th></tr></thead><tbody>
        {report.scores.map(score=><tr key={score.id}><td>{score.agent_name}{!score.agent_id&&<small className="hustle-note">Roster match needs review</small>}</td>
          <td className="hustle-score">{score.final_score==null?'—':Number(score.final_score).toLocaleString(undefined,{maximumFractionDigits:1})}{score.final_score==null&&<small className="hustle-note">Not scored</small>}</td>
          <td>{score.broker_action||'No recommendation supplied'}{score.ranking_eligible===false&&<small className="hustle-note">Not eligible for ranking</small>}</td>
          <td><details><summary>See report reasoning</summary><div className="hustle-proof"><p>{score.action_reason||'The publisher did not supply an explanation.'}</p><dl><dt>Evidence label</dt><dd>{score.evidence_label||'Not supplied'}</dd><dt>Eligibility</dt><dd>{score.eligibility?.replaceAll('-',' ')||'Not supplied'}</dd><dt>Recent offers</dt><dd>{score.offers_recent??'Not supplied'}</dd><dt>Report captured</dt><dd>{score.captured_at?new Date(score.captured_at).toLocaleString():'Not supplied'}</dd></dl><p>Published report explanation; underlying contact records are not included in this feed.</p></div></details></td></tr>)}
      </tbody></table></div>}
  </section>;
}
