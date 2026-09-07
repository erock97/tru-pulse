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
 const match = drawings.find(([pattern])=>pattern.test(label));
 return <span className={`pp-interest-pin pp-interest-pin-${seahawks?'seahawks':match?.[1] || 'forest'}`}>
   <span className="pp-interest-icon" aria-hidden="true">{seahawks ? <img src="/interest-icons/seahawks.png" alt=""/> : match ? <svg viewBox="0 0 50 50" focusable="false"><path d={match[2]}/></svg> : <span>{label.trim().slice(0,2).toUpperCase()}</span>}</span>
   <span className="pp-interest-label">{label}</span>
 </span>;
}
