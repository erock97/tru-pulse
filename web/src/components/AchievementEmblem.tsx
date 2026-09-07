import {useId} from 'react';
import type {ProfileBadge} from '../../../shared/agentProfile';

/** Illustrations describe the existing award; they do not determine eligibility. */
export default function AchievementEmblem({badge}: {badge: ProfileBadge}) {
  const id = useId();
  const tier = Number(badge.id.split(':')[1]) || 1;
  const welcome = badge.id === 'sample-training' || /welcome/i.test(badge.title);
  const design = badge.kind === 'contract' ? (tier === 1 ? 'key' : 'milestone') : (welcome ? 'door' : 'blueprint');
  const color = {key:'gold', milestone:'ruby', door:'emerald', blueprint:'sapphire'}[design];
  const metal = `url(#${id}-metal)`;
  const enamel = `url(#${id}-enamel)`;
  return <div className={`pp-award-art pp-award-${color} pp-pin-${design}`} aria-hidden="true">
    <svg viewBox="0 0 180 180" focusable="false">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff2c9"/><stop offset=".3" stopColor="#c5a165"/><stop offset=".52" stopColor="#fae3b0"/><stop offset="1" stopColor="#88704a"/></linearGradient>
        <linearGradient id={`${id}-enamel`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--award-light)"/><stop offset=".35" stopColor="var(--award-mid)"/><stop offset="1" stopColor="var(--award-dark)"/></linearGradient>
      </defs>
      {design === 'door' && <>
        <path d="M36 151V68a54 54 0 0 1 108 0v83Z" fill={metal}/>
        <path d="M43 145V69a47 47 0 0 1 94 0v76Z" fill={enamel}/>
        <path d="M58 139V73a32 32 0 0 1 64 0v66Z" fill="var(--award-face)" stroke={metal} strokeWidth="3"/>
        <path d="M63 75a27 27 0 0 1 54 0Z" fill="#bee8d0"/>
        <path d="M90 47v28M70 54l20 21 20-21" fill="none" stroke="var(--award-dark)" strokeWidth="2"/>
        <path d="M64 81h28v57H64Z" fill="#397d62" stroke={metal} strokeWidth="2"/>
        <path d="m94 81 22 8v50l-22-1Z" fill="#e4d3a4"/>
        <circle cx="86" cy="109" r="2.6" fill="#fae3b0"/>
        <path d="M30 146h120v9H30Zm-5 9h130v8H25Z" fill={metal}/>
        <path d="M48 125c-14-13-15-24-13-32m11 25-14-6m8-4-11-7" stroke="#aad8b4" strokeWidth="3" fill="none" strokeLinecap="round"/>
      </>}
      {design === 'blueprint' && <>
        <path d="m32 24 116 8 9 122-119 8-15-12Z" fill={metal}/>
        <path d="m37 31 104 7 9 110-107 7-13-10Z" fill={enamel}/>
        <g stroke="#d4eaff" strokeWidth=".65" opacity=".3"><path d="M43 49h96M43 67h98M43 85h100M43 103h102M43 121h104M57 37v108M77 38v109M97 39v107M117 40v104"/></g>
        <path d="m47 82 43-35 44 35M57 77v48h67V77" fill="var(--award-face)" stroke="#e4f2fc" strokeWidth="3" strokeLinejoin="round"/>
        <path d="m47 82 43-35 44 35M57 77v48h67V77M82 125V95h20v30M65 88h10v12H65Z" fill="none" stroke="#e4f2fc" strokeWidth="2.5" strokeLinejoin="round"/>
        <path d="M56 137h68m-68-4v8m68-8v8" stroke="#c7def6" strokeWidth="1.4"/>
        <circle cx="133" cy="133" r="22" fill={metal}/><circle cx="133" cy="133" r="17" fill="var(--award-face)"/>
        <path d="m123 133 7 7 13-15" fill="none" stroke="#e9d3a5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      </>}
      {design === 'key' && <g transform="rotate(-36 90 90)">
        <path d="M62 22h56l14 15v44l-24 18v55l-10 11H75V99L49 81V37Z" fill={metal} stroke="#876434" strokeWidth="1.5"/>
        <path d="M66 29h48l11 12v35l-22 17H80L56 76V41Z" fill={enamel}/>
        <path d="m70 64 20-18 20 18v20H70Z" fill="var(--award-face)" stroke="#ffedb9" strokeWidth="2.5"/>
        <path d="M86 83V68h9v15" fill="none" stroke="#ffedb9" strokeWidth="2.5"/>
        <path d="M82 99v55h16v-12h-8v-11h10v-12h-10V99" fill="#a7752d"/>
        <path d="M62 42v27m19 32v46" stroke="#fff4cf" strokeWidth="2" strokeLinecap="round" opacity=".8"/>
        <circle cx="91" cy="35" r="4" fill="var(--award-face)"/>
      </g>}
      {design === 'milestone' && <>
        <path d="m90 12 53 28 19 62-39 56H57l-39-56 19-62Z" fill={metal}/>
        <path d="m90 19 47 26 18 56-36 50H61l-36-50 18-56Z" fill={enamel}/>
        <path d="m90 19 1 29-48-3 16 32-34 24 38 11-2 39 29-23 29 23-1-39 37-11-34-24 16-32-46 3Z" fill="none" stroke="#f6c9c4" strokeWidth="1" opacity=".65"/>
        <path d="m90 47 31 30-3 35-28 17-27-17-4-35Z" fill="var(--award-face)" stroke={metal} strokeWidth="1.5"/>
        <text x="90" y="103" textAnchor="middle" fill="#ffe9ce" fontFamily="Georgia,serif" fontWeight="700" fontSize={tier>=100?'37':'47'}>{tier}</text>
        <path d="m75 137 15-5 15 5-15 7Z" fill="#f6c9c4"/>
      </>}
    </svg>
  </div>;
}
