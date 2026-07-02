import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TruLogo } from '../components/TruLogo';
import {
  loadVoiceProfile, saveVoiceProfile, generateSocialCalendar, loadSocialCalendar, setSocialContentStatus,
  type SocialContentItem,
} from '../lib/api';

const INK = '#33281a', GOLD = '#a9791f', GREEN = '#2e8b57', RED = '#c0492f', BLUE = '#2f6bb0', MUTE = '#8a7a63';

const PILLAR_COLOR: Record<string, string> = {
  market: BLUE, listing: GOLD, social_proof: GREEN, personality: '#8a5ca8', education: '#5b7a8c',
};
const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft — review', color: GOLD },
  approved: { label: 'Approved', color: GREEN },
  scheduled: { label: 'Scheduled', color: BLUE },
  posted: { label: 'Posted', color: MUTE },
  rejected: { label: 'Rejected', color: RED },
};

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ background: color + '1a', color, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

export default function Studio({ org, onHome }: { org: { id: string; name: string }; onHome: () => void }) {
  const [samplePosts, setSamplePosts] = useState('');
  const [audience, setAudience] = useState('');
  const [brokerageName, setBrokerageName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [tone, setTone] = useState<string | null>(null);

  const [focus, setFocus] = useState('');
  const [days, setDays] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState('');
  const [flaggedCount, setFlaggedCount] = useState<number | null>(null);

  const [items, setItems] = useState<SocialContentItem[]>([]);
  const [loadingCal, setLoadingCal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(true);

  async function refreshCalendar() {
    setLoadingCal(true);
    try { setItems(await loadSocialCalendar()); } catch (e) { setErr(String(e)); }
    setLoadingCal(false);
  }

  useEffect(() => {
    (async () => {
      try {
        const p = await loadVoiceProfile();
        if (p?.tone_summary) setTone(p.tone_summary);
        if (p?.sample_posts?.length) setSamplePosts(p.sample_posts.join('\n\n'));
        if (p?.audience) setAudience(p.audience);
        if (p?.brand_kit?.brokerageName) setBrokerageName(p.brand_kit.brokerageName);
        if (p?.brand_kit?.licenseNumber) setLicenseNumber(p.brand_kit.licenseNumber);
        if (p?.tone_summary) setShowSetup(false);
      } catch { /* first time — no profile yet, keep setup open */ }
      await refreshCalendar();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile() {
    setSavingProfile(true); setErr('');
    try {
      const posts = samplePosts.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      const p = await saveVoiceProfile({
        samplePosts: posts, audience: audience || undefined,
        brandKit: { brokerageName: brokerageName || undefined, licenseNumber: licenseNumber || undefined },
      });
      setTone(p.tone_summary ?? null);
      setShowSetup(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setSavingProfile(false);
  }

  async function generate() {
    if (generating || !focus.trim()) return;
    setGenerating(true); setErr(''); setFlaggedCount(null);
    try {
      const r = await generateSocialCalendar({ focus, days });
      setFlaggedCount(r.flagged);
      await refreshCalendar();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setGenerating(false);
  }

  async function setStatus(item: SocialContentItem, status: SocialContentItem['status']) {
    setBusy(item.id);
    try {
      await setSocialContentStatus(item.id, status);
      setItems((its) => its.map((x) => (x.id === item.id ? { ...x, status } : x)));
    } catch (e) { setErr(String(e)); }
    setBusy(null);
  }

  const drafts = items.filter((i) => i.status === 'draft');
  const approved = items.filter((i) => i.status !== 'draft' && i.status !== 'rejected');

  return (
    <div className="hq" style={{ minHeight: '100vh', background: 'var(--bg, #fbf7f0)' }}>
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="link small" onClick={onHome}>← HQ</button>
          <TruLogo size={26} wordSize={19} sub="Studio" />
        </div>
        <div className="topbar-right">
          <span className="muted small">{org.name}</span>
          <button className="link small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <main className="hq-main" style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px 60px' }}>
        <div className="hq-hero fu" style={{ marginBottom: 18 }}>
          <div className="eyebrow" style={{ color: '#8a5ca8' }}>Content engine</div>
          <h1 style={{ margin: '4px 0' }}>TRU Studio</h1>
          <p style={{ color: MUTE }}>
            A month of social content in one sitting — captions and scripts drafted in <strong>your</strong> voice,
            not a generic template pack. Every post is screened for fair-housing language and your disclosure
            before it ever reaches you.
          </p>
        </div>

        {/* Voice / brand setup */}
        <div className="hq-card fu" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Your voice</h3>
            <button className="link small" onClick={() => setShowSetup((s) => !s)}>{showSetup ? 'Hide' : 'Edit'}</button>
          </div>
          {tone && !showSetup && (
            <p className="muted small" style={{ marginTop: 8 }}>“{tone}”</p>
          )}
          {showSetup && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 12.5, color: MUTE }}>
                Paste a few of your past captions (blank line between each) — this is what TRU learns your voice from
                <textarea
                  value={samplePosts}
                  onChange={(e) => setSamplePosts(e.target.value)}
                  rows={5}
                  placeholder={'Just closed on this beauty in Maple Grove! 🎉\n\nSo grateful for clients like these...'}
                  style={{ display: 'block', width: '100%', marginTop: 4, padding: '10px 12px', border: '1px solid var(--line,#e6dac6)', borderRadius: 10, fontSize: 13.5, fontFamily: 'inherit' }}
                />
              </label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: MUTE }}>
                  Audience (optional)
                  <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="First-time buyers, luxury, relocation…"
                    style={{ display: 'block', width: '100%', marginTop: 4, padding: '10px 12px', border: '1px solid var(--line,#e6dac6)', borderRadius: 10, fontSize: 14 }} />
                </label>
                <label style={{ flex: 1, minWidth: 160, fontSize: 12.5, color: MUTE }}>
                  Brokerage name
                  <input value={brokerageName} onChange={(e) => setBrokerageName(e.target.value)} placeholder="Costigan Group"
                    style={{ display: 'block', width: '100%', marginTop: 4, padding: '10px 12px', border: '1px solid var(--line,#e6dac6)', borderRadius: 10, fontSize: 14 }} />
                </label>
                <label style={{ minWidth: 120, fontSize: 12.5, color: MUTE }}>
                  License #
                  <input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} placeholder="12345"
                    style={{ display: 'block', width: '100%', marginTop: 4, padding: '10px 12px', border: '1px solid var(--line,#e6dac6)', borderRadius: 10, fontSize: 14 }} />
                </label>
              </div>
              <div>
                <button className="btn" onClick={saveProfile} disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save voice & brand'}</button>
              </div>
            </div>
          )}
        </div>

        {/* Generate */}
        <div className="hq-card fu" style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>Generate a calendar</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ flex: 1, minWidth: 260, fontSize: 12.5, color: MUTE }}>
              What's going on right now?
              <input
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="Listing a 3-bed in Maple Grove this month, want to build local authority"
                style={{ display: 'block', width: '100%', marginTop: 4, padding: '10px 12px', border: '1px solid var(--line,#e6dac6)', borderRadius: 10, fontSize: 14 }}
              />
            </label>
            <label style={{ fontSize: 12.5, color: MUTE }}>
              Days
              <input type="number" min={7} max={31} value={days} onChange={(e) => setDays(Math.max(7, Math.min(31, Number(e.target.value) || 30)))}
                style={{ display: 'block', width: 80, marginTop: 4, padding: '10px 12px', border: '1px solid var(--line,#e6dac6)', borderRadius: 10, fontSize: 14 }} />
            </label>
            <button className="btn" onClick={generate} disabled={generating || !focus.trim()}>{generating ? 'Writing…' : 'Generate →'}</button>
          </div>
          {flaggedCount !== null && (
            <div className="muted small" style={{ marginTop: 10 }}>
              Generated{flaggedCount > 0 ? `, ${flaggedCount} post${flaggedCount === 1 ? '' : 's'} flagged for review below` : ' — nothing flagged'}.
            </div>
          )}
          {err && <div className="err" style={{ marginTop: 10, color: RED }}>{err}</div>}
        </div>

        {loadingCal && <div className="center-wrap"><div className="spinner" /></div>}

        {!loadingCal && drafts.length > 0 && (
          <>
            <h3 style={{ margin: '4px 0 10px' }}>Needs your review <span className="muted small">({drafts.length})</span></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {drafts.map((it) => (
                <div key={it.id} style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#e6dac6)', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Pill text={it.pillar} color={PILLAR_COLOR[it.pillar] ?? MUTE} />
                      <span className="muted small">{it.format} · {new Date(it.scheduled_for).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <Pill text={STATUS_STYLE[it.status]?.label ?? it.status} color={STATUS_STYLE[it.status]?.color ?? MUTE} />
                  </div>
                  <div style={{ marginTop: 8, fontWeight: 700, color: INK }}>{it.hook}</div>
                  <div style={{ marginTop: 4, fontSize: 13.5, color: INK, whiteSpace: 'pre-wrap' }}>{it.caption}</div>
                  {it.script && <div className="muted small" style={{ marginTop: 6 }}>🎬 {it.script}</div>}
                  {!it.compliance?.fair_housing_ok && (it.compliance?.flags?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: RED, background: RED + '12', borderRadius: 8, padding: '6px 10px' }}>
                      ⚠️ Flagged for review: {it.compliance.flags!.join('; ')}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button onClick={() => setStatus(it, 'approved')} disabled={busy === it.id}
                      style={{ border: `1px solid ${GREEN}`, background: GREEN + '14', color: GREEN, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      Approve
                    </button>
                    <button onClick={() => setStatus(it, 'rejected')} disabled={busy === it.id}
                      style={{ border: `1px solid ${RED}`, background: 'transparent', color: RED, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!loadingCal && approved.length > 0 && (
          <>
            <h3 style={{ margin: '4px 0 10px' }} className="muted">Approved / scheduled <span className="small">({approved.length})</span></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {approved.map((it) => (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'var(--card,#fff)', border: '1px solid var(--line,#e6dac6)', borderRadius: 10, padding: '8px 12px' }}>
                  <div className="small">
                    <Pill text={it.pillar} color={PILLAR_COLOR[it.pillar] ?? MUTE} /> <span style={{ color: INK }}>{it.hook}</span>
                    <span className="muted"> · {new Date(it.scheduled_for).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <Pill text={STATUS_STYLE[it.status]?.label ?? it.status} color={STATUS_STYLE[it.status]?.color ?? MUTE} />
                </div>
              ))}
            </div>
          </>
        )}

        {!loadingCal && items.length === 0 && (
          <div className="muted" style={{ textAlign: 'center', padding: 30 }}>No content yet — generate your first calendar above.</div>
        )}
      </main>
    </div>
  );
}
