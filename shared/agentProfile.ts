export const PROFILE_SECTIONS=['about','interests','goals','gallery','achievements'] as const;
export type ProfileSection=typeof PROFILE_SECTIONS[number];
export const PROFILE_THEMES=['sage','midnight','ocean','plum','sunset'] as const;
export type PersonalProfile={termsVersion:string;sectionTitles:Partial<Record<ProfileSection,string>>;layout:'story'|'photos'|'compact';coverPosition:number;portraitPosition:number;bio:string;headline:string;location:string;markets:string;careerStart:string;goal:string;favorite:string;theme:typeof PROFILE_THEMES[number];font:'classic'|'modern'|'editorial';coverStyle:'orbit'|'waves'|'grid';accent:string;portrait:string;cover:string;interests:string[];gallery:{caption:string;image:string}[];sections:ProfileSection[];hidden:ProfileSection[]};
export type ProfileBadge={id:string;title:string;detail:string;verifiedAt:string;kind:'training'|'contract'};
export const DEFAULT_PROFILE:PersonalProfile={termsVersion:'',sectionTitles:{},layout:'story',coverPosition:50,portraitPosition:50,bio:'',headline:'',location:'',markets:'',careerStart:'',goal:'',favorite:'',theme:'sage',font:'classic',coverStyle:'orbit',accent:'#bdd1ed',portrait:'',cover:'',interests:[],gallery:[],sections:[...PROFILE_SECTIONS],hidden:[]};
const image=(value:unknown)=>{
 if(typeof value!=='string')throw Error('Choose a valid image.');
 if(!value)return '';
 if(value.length>400000)throw Error('That image is too large. Try a smaller photo.');
 const match=value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!match)throw Error('Use a JPG, PNG, or WebP image.');
 const head=atob(match[2].slice(0,32));
 if(!(match[1]==='jpeg'&&head.startsWith('\xff\xd8\xff')||match[1]==='png'&&head.startsWith('\x89PNG\r\n\x1a\n')||match[1]==='webp'&&head.startsWith('RIFF')&&head.slice(8,12)==='WEBP'))throw Error('The image format could not be verified.');
 return value;
};
export function validateProfile(raw:unknown):PersonalProfile {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Profile is missing.');
 const p={termsVersion:'',sectionTitles:{},layout:'story',coverPosition:50,portraitPosition:50,...raw} as Record<string,unknown>;
 const titles=p.sectionTitles;
 if(!titles||typeof titles!=='object'||Array.isArray(titles)||Object.entries(titles).some(([k,v])=>!PROFILE_SECTIONS.includes(k as ProfileSection)||typeof v!=='string'||v.length>48))throw Error('Keep section titles under 48 characters.');
 const sectionTitles=Object.fromEntries(Object.entries(titles).map(([k,v])=>[k,(v as string).trim()]));
 const position=(key:string)=>{const n=p[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100)throw Error('Choose a valid photo position.');return n;};
 if(!['','2026-09-06'].includes(p.termsVersion as string))throw Error('Invalid profile terms version.');
 if(Object.keys(p).some(k=>!Object.prototype.hasOwnProperty.call(DEFAULT_PROFILE,k)))throw Error('Unknown profile field.');
 const text=(key:string,max:number)=>{if(typeof p[key]!=='string'||(p[key] as string).length>max)throw Error(`Check ${key} (${max} characters maximum).`);return (p[key] as string).trim();};
 const one=<T extends string>(key:string,choices:readonly T[]):T=>{if(!choices.includes(p[key] as T))throw Error(`Choose a valid ${key}.`);return p[key] as T;};
 const list=(key:string,max:number)=>{if(!Array.isArray(p[key])||p[key].length>max||p[key].some(v=>typeof v!=='string'))throw Error(`Check ${key}.`);return [...new Set(p[key] as string[])];};
 const sections=list('sections',5);if(sections.length!==5||sections.some(v=>!PROFILE_SECTIONS.includes(v as ProfileSection)))throw Error('Each profile section must appear once.');
 const hidden=list('hidden',5);if(hidden.some(v=>!PROFILE_SECTIONS.includes(v as ProfileSection)))throw Error('Unknown section.');
 const interests=list('interests',8).map(v=>v.trim());if(interests.some(v=>!v||v.length>32))throw Error('Keep interests under 32 characters.');
 const year=text('careerStart',4);if(year&&(!/^\d{4}$/.test(year)||+year<1950||+year>new Date().getFullYear()))throw Error('Check the year you started in real estate.');
 const accent=text('accent',7);if(!/^#[0-9a-f]{6}$/i.test(accent))throw Error('Choose a valid accent color.');
 if(!Array.isArray(p.gallery)||p.gallery.length>3)throw Error('Choose up to three personal photos.');
 const gallery=p.gallery.map((g:unknown)=>{if(!g||typeof g!=='object')throw Error('Check your photos.');const item=g as {caption:unknown;image:unknown};if(typeof item.caption!=='string'||item.caption.length>60)throw Error('Keep photo captions under 60 characters.');return {caption:item.caption.trim(),image:image(item.image)};});
 return {termsVersion:p.termsVersion as string,sectionTitles,layout:one('layout',['story','photos','compact']),coverPosition:position('coverPosition'),portraitPosition:position('portraitPosition'),headline:text('headline',100),bio:text('bio',1200),location:text('location',80),markets:text('markets',160),goal:text('goal',280),favorite:text('favorite',160),careerStart:year,theme:one('theme',PROFILE_THEMES),font:one('font',['classic','modern','editorial']),coverStyle:one('coverStyle',['orbit','waves','grid']),accent,portrait:image(p.portrait),cover:image(p.cover),interests,gallery,sections:sections as ProfileSection[],hidden:hidden as ProfileSection[]};
}
