import {useId} from 'react';
const drawings: [RegExp, string, string][] = [
 [/hik|outdoor|mountain/i,'forest','M7 32 20 9l8 14 6-9 15 25H4Zm7-12 6 4 5-3M32 23l4 3'],
 [/coffee|tea/i,'coffee','M10 15h26v15a10 10 0 0 1-10 10h-6a10 10 0 0 1-10-10Zm26 3h5a6 6 0 0 1 0 12h-5M17 6v4m8-4v4m8-4v4M8 44h32'],
 [/cook|food|baking/i,'clay','M12 19a8 8 0 1 1 4-15 10 10 0 0 1 18 0 8 8 0 1 1 4 15v20H12Zm0 13h26M20 20v8m10-8v8'],
 [/football|sports/i,'clay','M5 38C3 14 18 3 44 6c4 26-10 40-36 36ZM14 32l21-19M19 20l10 10m-5-15 10 10'],
 [/music|concert/i,'plum','M20 34V10l22-4v25M20 18l22-5M20 34a7 5 0 1 1-14 0 7 5 0 0 1 14 0Zm22-3a7 5 0 1 1-14 0 7 5 0 0 1 14 0Z'],
 [/architect|homes/i,'ocean','M7 42V17L25 5l18 12v25Zm8 0V23h20v19M21 42V30h8v12M25 12v5'],
 [/travel/i,'ocean','m5 27 16-5V8q4-6 8 0v14l16 5v6l-16-4v10l6 4v4l-10-3-10 3v-4l6-4V29L5 33Z'],
 [/dog|cat|pet/i,'clay','M14 30q11-17 22 0c12 18-4 14-11 13S2 48 14 30ZM7 19a4 6 0 1 0 8 0 4 6 0 1 0-8 0m12-8a4 6 0 1 0 8 0 4 6 0 1 0-8 0m13 5a4 6 0 1 0 8 0 4 6 0 1 0-8 0'],
 [/garden/i,'forest','M25 44V23C7 26 6 13 7 6c15 0 22 5 18 17Zm0 11c-1-16 9-21 19-19 0 14-5 20-19 19'],
 [/photo/i,'ocean','M6 15h10l4-7h12l4 7h9v28H6Zm10 14a10 10 0 1 0 20 0 10 10 0 1 0-20 0M37 20h3'],
 [/read|book/i,'plum','M25 12C17 6 8 7 4 9v32c8-3 15-2 21 3 7-5 14-6 22-3V9c-8-2-15-2-22 3v32'],
 [/fitness|gym/i,'clay','M6 16v20m7-26v32m25-32v32m7-26v20M13 26h25'],
 [/family|volunteer/i,'plum','M25 42 7 24C-5 9 13-2 25 13 37-2 55 9 43 24Z'],
 [/art|paint/i,'clay','M26 5C1 5-2 38 19 44c12 4 5-10 13-10 22 0 18-29-6-29ZM13 17h1m11-4h1m10 6h1M10 29h1'],
];
export default function InterestPin({label}: {label: string}) {
 const seahawks = /^(seattle\s+)?seahawks?$/i.test(label.trim());
 const id = useId();
 const genre = /^(jazz|blues|rock|classic rock|country|hip[ -]?hop|r&b|soul|classical|electronic|edm|pop|indie|folk|metal)$/i.test(label.trim()) ? label.trim().toLowerCase() : '';
 const match = drawings.find(([pattern])=>pattern.test(label));
 return <span className={`pp-interest-pin pp-interest-pin-${seahawks?'seahawks':genre?'plum':match?.[1] || 'forest'}`}>
   <span className="pp-interest-icon" aria-hidden="true">{seahawks ? <img src="/interest-icons/seahawks.png" alt=""/> : <svg className="pp-plated-emblem" viewBox="0 0 100 100" focusable="false">
     <defs>
       <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff1ce"/><stop offset=".23" stopColor="#b89b64"/><stop offset=".48" stopColor="#f3e0b4"/><stop offset=".72" stopColor="#8b7045"/><stop offset="1" stopColor="#d8bf8c"/></linearGradient>
       <linearGradient id={`${id}-face`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="var(--pin-ink)"/><stop offset="1" stopColor="#131e24"/></linearGradient>
       <linearGradient id={`${id}-silver`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffef"/><stop offset=".45" stopColor="#d5d8d1"/><stop offset="1" stopColor="#73868b"/></linearGradient>
     </defs>
     <circle cx="50" cy="50" r="46" fill={`url(#${id}-rim)`}/>
     <circle cx="50" cy="50" r="41" fill={`url(#${id}-face)`} stroke="#10181c" strokeWidth="1.5"/>
     <path d="M15 49a35 35 0 0 1 66-17" fill="none" stroke="#fff2d4" strokeWidth=".8" opacity=".35"/>
     <g fill={`url(#${id}-silver)`} stroke="none">
     {/hik|outdoor|mountain/i.test(label) ? <><circle cx="67" cy="32" r="8" fill={`url(#${id}-rim)`}/><path d="m17 70 25-43 14 23 10-10 20 30Z"/><path d="m42 27-4 34 18-11Zm24 13-2 23 22 7Z" fill="#4a686c"/><path d="m37 36 5-9 8 13-7-4-3 4Z" fill="#fff5db"/><path d="M21 75h59" stroke={`url(#${id}-rim)`} strokeWidth="2"/></> :
     /coffee|tea/i.test(label) ? <><path d="M27 39h39v20c0 19-39 19-39 0Z"/><path d="M66 43h7c17 0 14 22-7 21v-5c14 0 15-11 7-11h-7Z"/><ellipse cx="46.5" cy="39" rx="19.5" ry="5" fill={`url(#${id}-rim)`}/><ellipse cx="46.5" cy="40" rx="15" ry="3" fill="#493226"/><path d="M21 73q27 11 54 0Z" fill={`url(#${id}-rim)`}/><path d="M39 30c-9-8 9-8 0-16m13 16c-9-8 9-8 0-16" fill="none" stroke="#d3c5a6" strokeWidth="2"/></> :
     /cook|food|baking/i.test(label) ? <><path d="m62 38 16-16q7-2 5 5L68 44Z" fill={`url(#${id}-rim)`}/><circle cx="44" cy="56" r="25"/><circle cx="44" cy="56" r="20" fill="#263237"/><path d="M28 58q16-25 31-5-9 20-31 5" fill="#d7ae58"/><path d="m31 58 22-10m-15 17 18-12" stroke="#a45d30" strokeWidth="3"/><path d="m32 40 8-5 2 9m8 18 10 4-9 5" fill="#81a67a"/></> :
     /architect|homes/i.test(label) ? <><path d="m22 35 28-17 28 17v5H22Z" fill={`url(#${id}-rim)`}/><path d="M27 44h8v26h-8Zm19 0h8v26h-8Zm19 0h8v26h-8Z"/><path d="M23 71h54v5H23Zm-4 6h62v5H19Z" fill={`url(#${id}-rim)`}/><path d="M30 46v21m19-21v21m19-21v21" stroke="#fff7e1" strokeWidth="1"/></> :
     genre || /music|concert/i.test(label) ? <>
       {/rock|metal|country|folk|indie/.test(genre) ? <g transform="rotate(32 50 50)"><path d="M46 19h8v37h-8Z" fill={`url(#${id}-rim)`}/><path d="m44 12 12 1-1 15H45Z"/><path d="M39 49q-16 6-8 15-12 18 8 23h22q20-5 8-23 8-9-8-15-11 10-22 0Z" fill={`url(#${id}-rim)`}/><circle cx="50" cy="68" r="7" fill="#263237"/><path d="M49 28v49m3-49v49" stroke="#fff1cf" strokeWidth="1"/></g> :
       /jazz|blues/.test(genre) ? <><path d="M39 20h18v7H44v31q0 15 15 9V50h-7l12-15 13 15h-8v20C41 87 32 67 34 55V28h-8v-5h13Z" fill={`url(#${id}-rim)`}/><path d="M42 34h7m-7 8h7m-7 8h7" stroke="#fff5df" strokeWidth="3"/></> :
       genre === 'classical' ? <><path d="M24 29q40-26 53 8v34H24Z"/><path d="M24 58h53v15H24Z" fill="#fcf1d4"/><path d="M32 59v13m9-13v13m9-13v13m9-13v13m9-13v13" stroke="#263237" strokeWidth="2"/><path d="M29 74v9m43-9v9" stroke={`url(#${id}-rim)`} strokeWidth="4"/></> :
       /electronic|edm/.test(genre) ? <><path d="M24 37h6v29h-6Zm12-12h6v53h-6Zm12 20h6v20h-6Zm12-25h6v59h-6Zm12 17h6v29h-6Z" fill={`url(#${id}-rim)`}/></> :
       <><circle cx="50" cy="50" r="29" fill="#10171b" stroke={`url(#${id}-silver)`} strokeWidth="3"/><circle cx="50" cy="50" r="22" fill="none" stroke="#829092" strokeWidth="1"/><circle cx="50" cy="50" r="16" fill="none" stroke="#829092" strokeWidth="1"/><circle cx="50" cy="50" r="10" fill={`url(#${id}-rim)`}/><circle cx="50" cy="50" r="3" fill="#111b20"/><path d="m29 29 11 11m20 20 11 11" stroke="#d5ded8" strokeWidth="2" opacity=".5"/></>}
     </> : match ? <g transform="translate(23 23) scale(1.08)" fill="none" stroke={`url(#${id}-silver)`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d={match[2]}/></g> : <text x="50" y="60" textAnchor="middle" fontFamily="Georgia,serif" fontSize="27">{label.trim().slice(0,2).toUpperCase()}</text>}
     </g>
   </svg>}</span>
   <span className="pp-interest-label">{label}</span>
 </span>;
}
