import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE as BASE_PROFILE } from '../../../shared/agentProfile';
import { workerFetch } from './api';
import { deletePersonalProfile, prepareProfilePhoto, readPersonalProfile, savePersonalProfile } from './personalProfile';
const DEFAULT_PROFILE={...BASE_PROFILE,termsVersion:'2026-09-06'};
vi.mock('./api', () => ({ isDemo: false, workerFetch: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('account profile client', () => {
  it('saves validated content through authenticated workerFetch without accepting an owner argument', async () => {
    vi.mocked(workerFetch).mockResolvedValue(new Response(JSON.stringify({ profile: DEFAULT_PROFILE, updatedAt: '2026-01-01' })));
    await savePersonalProfile(DEFAULT_PROFILE);
    expect(workerFetch).toHaveBeenCalledWith('/data/personal-profile', expect.objectContaining({ method: 'PUT' }));
    expect(JSON.parse(vi.mocked(workerFetch).mock.calls[0][1]?.body as string)).toEqual(DEFAULT_PROFILE);
  });
  it('reports a rejected save and never falls back to a local success', async () => {
    vi.mocked(workerFetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Please sign in again.' }), { status: 401 }));
    await expect(savePersonalProfile(DEFAULT_PROFILE)).rejects.toThrow('Please sign in again.');
  });
  it('does not display default data as though an unavailable profile had loaded', async () => {
    vi.mocked(workerFetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }));
    await expect(readPersonalProfile()).rejects.toThrow('Unavailable');
  });
  it('rejects invalid content before making a request', async () => {
    await expect(savePersonalProfile({ ...DEFAULT_PROFILE, bio: 'x'.repeat(1201) })).rejects.toThrow();
    expect(workerFetch).not.toHaveBeenCalled();
  });
});
describe('photo preparation', () => {
  it('rejects active formats and oversized files before decoding', async () => {
    await expect(prepareProfilePhoto(new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }), 480)).rejects.toThrow('JPG');
    await expect(prepareProfilePhoto(new File([new Uint8Array(13 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' }), 480)).rejects.toThrow('12 MB');
  });
  it('bounds decoded dimensions, compresses the image, and releases the temporary URL', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('Image', class { naturalWidth = 3000; naturalHeight = 2000; src = ''; decode = async () => {}; });
    const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }), toDataURL: vi.fn().mockReturnValueOnce('x'.repeat(400001)).mockReturnValue('data:image/jpeg;base64,/9j/AAA=') };
    vi.stubGlobal('document', { createElement: () => canvas });
    expect(await prepareProfilePhoto(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }), 480)).toBe('data:image/jpeg;base64,/9j/AAA=');
    expect([canvas.width, canvas.height]).toEqual([480, 320]);
    expect(canvas.toDataURL).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
  it('releases the temporary URL after a decode failure', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:broken');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('Image', class { src = ''; decode = async () => { throw Error('Invalid photo'); }; });
    await expect(prepareProfilePhoto(new File(['bad'], 'bad.jpg', { type: 'image/jpeg' }), 480)).rejects.toThrow('Invalid photo');
    expect(revoke).toHaveBeenCalledWith('blob:broken');
  });
});

describe('profile deletion client',()=>{
 it('uses the authenticated owner-only DELETE endpoint',async()=>{vi.mocked(workerFetch).mockResolvedValue(new Response(JSON.stringify({deleted:true})));await deletePersonalProfile();expect(workerFetch).toHaveBeenCalledWith('/data/personal-profile',{method:'DELETE'});});
 it('does not report a failed deletion as successful',async()=>{vi.mocked(workerFetch).mockResolvedValue(new Response(JSON.stringify({error:'Try again'}),{status:503}));await expect(deletePersonalProfile()).rejects.toThrow('Try again');});
 it('does not submit a save before the upload agreement',async()=>{await expect(savePersonalProfile(BASE_PROFILE)).rejects.toThrow('agree');expect(workerFetch).not.toHaveBeenCalled();});
});
