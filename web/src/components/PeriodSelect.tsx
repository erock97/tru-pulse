import './periodSelect.css';
export function PeriodSelect({value,options,onChange}:{value:string;options:readonly {value:string;label:string}[];onChange:(value:string)=>void}){
  return <label className="pulse-period-control"><span>Period</span><select aria-label="Reporting period" value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
