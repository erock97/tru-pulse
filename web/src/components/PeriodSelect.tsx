import './periodSelect.css';
export function PeriodSelect({value,options,onChange,label='Reporting period'}:{value:string;options:readonly {value:string;label:string}[];onChange:(value:string)=>void;label?:string}){
  return <label className="pulse-period-control"><span>{label==='Reporting period'?'Period':label}</span><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
