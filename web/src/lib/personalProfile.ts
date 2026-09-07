import { DEFAULT_PROFILE, validateProfile, type PersonalProfile, type ProfileBadge } from '../../../shared/agentProfile';
import { isDemo, workerFetch } from './api';

export type ProfileRecord = { profile: PersonalProfile; updatedAt: string | null; badges: ProfileBadge[]; badgeNotice?: string };
const completeDemo = isDemo && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('profileExample') === 'complete';
const DELETED_DEMO_KEY = completeDemo ? 'tru-profile-example-deleted-v1' : 'tru-profile-demo-deleted';
const DEMO_KEY = completeDemo ? 'tru-profile-example-v1' : 'tru-personal-profile-demo-v1';
const demoProfile: PersonalProfile = { ...DEFAULT_PROFILE, headline: 'Portland agent, weekend hiker, enthusiastic home cook.', bio: 'I’m Jordan. I help people find their place in the Pacific Northwest.\n\nAway from work, I’m usually on a trail, trying a new coffee shop, or making dinner for a house full of friends.', location: 'Portland, Oregon', markets: 'Portland · Beaverton · Lake Oswego', careerStart: '2021', goal: 'Help five first-time buyers get the keys to their own home this year.', favorite: 'A slow Sunday morning, with nowhere to be.', interests: ['Hiking', 'Coffee', 'Cooking', 'Live music', 'Architecture'], font: 'editorial' };
async function photoDemo(): Promise<PersonalProfile> {
  const images = await Promise.all(['portrait', 'gorge', 'trail', 'dinner'].map(async name => {
    const response = await fetch(`/profile-demo/${name}.jpg`);
    if (!response.ok) throw Error('The sample photos could not be loaded. Please try again.');
    const file = new File([await response.blob()], `${name}.jpg`, {type: 'image/jpeg'});
    return prepareProfilePhoto(file, name === 'portrait' ? 480 : 1000);
  }));
  return validateProfile({...demoProfile,
    headline: 'Portland is home. There’s usually a hike planned for Saturday.',
    bio: 'I moved to Portland for a job and stayed for the neighborhoods. I’ve worked in real estate since 2021, mostly with people buying their first place. I like explaining the parts of the process that nobody explained to me.\n\nOutside work, I cook for friends, see live music when I can, and spend a lot of weekends on muddy trails. Send me a good pasta recipe and I’ll probably try it.',
    favorite: 'Coffee on the porch before the rest of the house wakes up.',
    portrait: images[0], cover: images[1], coverPosition: 55,
    gallery: [{image: images[2], caption: 'Saturday mornings, rain or shine.'}, {image: images[3], caption: 'The recipe I keep coming back to.'}],
    sectionTitles: {gallery: 'Away from work'},
    sections: ['about', 'gallery', 'interests', 'goals', 'achievements'],
  });
}
export async function readPersonalProfile(): Promise<ProfileRecord> {
  if (isDemo) {
    if(localStorage.getItem(DELETED_DEMO_KEY))return {profile:structuredClone(DEFAULT_PROFILE),updatedAt:null,badges:[]};
    const raw = localStorage.getItem(DEMO_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return { profile: saved ? validateProfile(saved.profile) : (completeDemo ? await photoDemo() : structuredClone(demoProfile)), updatedAt: saved?.updatedAt ?? (completeDemo ? '2026-09-07T00:00:00Z' : null), badges: [...(completeDemo ? [{ id: 'training:day4', kind: 'training' as const, title: 'Zillow Home Loans', detail: 'Sample training badge', verifiedAt: '' }, { id: 'contracts:10', kind: 'contract' as const, title: '10 recorded contracts', detail: 'Sample contract milestone', verifiedAt: '' }] : []), { id: 'sample-training', kind: 'training', title: 'Welcome to Preferred', detail: 'Sample training badge', verifiedAt: '' }, { id: 'sample-contract', kind: 'contract', title: 'First contract', detail: 'Sample contract badge', verifiedAt: '' }] };
  }
  const response = await workerFetch('/data/personal-profile');
  const body = await response.json();
  if (!response.ok) throw Error(body.error || 'Your profile could not be loaded.');
  return { ...body, profile: validateProfile(body.profile) };
}
export async function savePersonalProfile(profile: PersonalProfile): Promise<{ profile: PersonalProfile; updatedAt: string }> {
  const clean = validateProfile(profile);
  if(clean.termsVersion!=='2026-09-06')throw Error('Please agree to the profile content terms before saving.');
  if (isDemo) {
    const saved = { profile: clean, updatedAt: new Date().toISOString() };
    localStorage.setItem(DEMO_KEY, JSON.stringify(saved));
    localStorage.removeItem(DELETED_DEMO_KEY);
    return saved;
  }
  const response = await workerFetch('/data/personal-profile', { method: 'PUT', body: JSON.stringify(clean) });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || 'Your changes could not be saved.');
  return { ...body, profile: validateProfile(body.profile) };
}

/** Resize before upload; external URLs and active image formats are never stored. */
export async function prepareProfilePhoto(file: File, maxSide: number): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw Error('Choose a JPG, PNG, or WebP photo.');
  if (file.size > 12 * 1024 * 1024) throw Error('Choose a photo smaller than 12 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('Photos could not be prepared in this browser.');
    context.fillStyle = '#f2eee5'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [.86, .72, .56, .4]) {
      const result = canvas.toDataURL('image/jpeg', quality);
      if (result.length <= 400000) return result;
    }
    throw Error('That photo is still too large. Try a smaller image.');
  } finally { URL.revokeObjectURL(url); }
}

export async function deletePersonalProfile():Promise<void>{
 if(isDemo){localStorage.setItem(DELETED_DEMO_KEY,'1');localStorage.removeItem(DEMO_KEY);return;}
 const response=await workerFetch('/data/personal-profile',{method:'DELETE'});
 if(!response.ok){const body=await response.json();throw Error(body.error||'Your profile could not be deleted. Please try again.');}
}
