import { useState, type FormEvent } from 'react';
import { BUSINESS } from '../../config/business';
import './apply.css';

// Fields carried over exactly from the old application form. NO PHONE FIELD —
// confirmed 2026-08-09. Collecting a number we might call or text is the most
// aggressively litigated part of a lead form, and we do not need it to reply.
const ROLES = [
  'Brokerage owner',
  'Team leader',
  'Solo producer scaling into a team',
  'Other',
] as const;

const TEAM_SIZES = ['1 (just me)', '2–5', '6–20', '21–50', '50+'] as const;

// Stored verbatim with every submission, so what someone agreed to is provable
// later rather than inferred from whatever the page happens to say today.
const CONSENT_TEXT =
  'By submitting, you agree to our Terms and Privacy Policy. We will use this information ' +
  'to respond to your application. We never sell your information.';

const OPT_IN_TEXT =
  'Send me occasional notes on real estate sales operations. Unsubscribe any time.';

type Errors = Partial<Record<'fullName' | 'email' | 'role' | 'teamSize' | 'bottleneck', string>>;

export default function Apply() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [bottleneck, setBottleneck] = useState('');
  // Unticked by default, and never a condition of submitting.
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot

  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function validate(): Errors {
    const e: Errors = {};
    if (!fullName.trim()) e.fullName = 'Please tell us your name.';
    if (!email.trim()) e.email = 'Please give us a work email so we can reply.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'That email address looks wrong.';
    if (!role) e.role = 'Please pick the closest match.';
    if (!teamSize) e.teamSize = 'Please pick a range.';
    if (!bottleneck.trim()) e.bottleneck = 'A sentence or two is plenty.';
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setFailed(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      const first = document.querySelector<HTMLElement>('.field.invalid input, .field.invalid select, .field.invalid textarea');
      first?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_WORKER_URL}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName, email, role, teamSize, bottleneck,
          marketingOptIn,
          consentText: CONSENT_TEXT,
          consentAt: new Date().toISOString(),
          sourcePath: window.location.pathname,
          website,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || `Something went wrong (${res.status}).`);
      setDone(true);
    } catch (err) {
      // A lead must never be lost to a failed request — the fallback routes
      // them straight to the calendar and the inbox.
      setFailed(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  const field = (name: keyof Errors) => `field${errors[name] ? ' invalid' : ''}`;
  const describedBy = (name: keyof Errors) => (errors[name] ? `${name}-error` : undefined);

  if (done) {
    return (
      <div className="interior">
        <section className="panel band" id="top"><div className="wrap">
          <div className="kick">Apply</div>
          <h1 className="h2" style={{ marginTop: '1rem' }}>Got it &mdash; <em>thank you</em>.</h1>
          <div className="applydone">
            <h2>We&rsquo;ll be in touch within two business days.</h2>
            <p>
              Every application is reviewed personally. If you&rsquo;d rather not wait, you can put
              time straight on the calendar &mdash;{' '}
              <a href={BUSINESS.calendly} target="_blank" rel="noopener noreferrer">book a 30-minute call</a>.
            </p>
          </div>
        </div></section>
      </div>
    );
  }

  return (
    <div className="interior">
      <section className="panel band" id="top"><div className="wrap">
        <div className="kick">Apply</div>
        <h1 className="h2" style={{ marginTop: '1rem' }}>Tell us about <em>your team</em>.</h1>
        <p className="sub">
          Five short questions. We review every application personally and reply within two
          business days.
        </p>

        <form className="applyform" onSubmit={onSubmit} noValidate>
          <div className={field('fullName')}>
            <label htmlFor="fullName">Full name</label>
            <input
              id="fullName" name="fullName" type="text" autoComplete="name" required
              value={fullName} onChange={(e) => setFullName(e.target.value)}
              aria-describedby={describedBy('fullName')} aria-invalid={!!errors.fullName}
            />
            {errors.fullName && <span className="field-error" id="fullName-error">{errors.fullName}</span>}
          </div>

          <div className={field('email')}>
            <label htmlFor="email">Work email</label>
            <input
              id="email" name="email" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              aria-describedby={describedBy('email')} aria-invalid={!!errors.email}
            />
            {errors.email && <span className="field-error" id="email-error">{errors.email}</span>}
          </div>

          <div className={field('role')}>
            <label htmlFor="role">Your role</label>
            <select
              id="role" name="role" required value={role} onChange={(e) => setRole(e.target.value)}
              aria-describedby={describedBy('role')} aria-invalid={!!errors.role}
            >
              <option value="">— Select one —</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {errors.role && <span className="field-error" id="role-error">{errors.role}</span>}
          </div>

          <div className={field('teamSize')}>
            <label htmlFor="teamSize">Team size</label>
            <select
              id="teamSize" name="teamSize" required value={teamSize}
              onChange={(e) => setTeamSize(e.target.value)}
              aria-describedby={describedBy('teamSize')} aria-invalid={!!errors.teamSize}
            >
              <option value="">— Select one —</option>
              {TEAM_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {errors.teamSize && <span className="field-error" id="teamSize-error">{errors.teamSize}</span>}
          </div>

          <div className={field('bottleneck')}>
            <label htmlFor="bottleneck">What&rsquo;s the biggest bottleneck right now?</label>
            <textarea
              id="bottleneck" name="bottleneck" required maxLength={5000}
              value={bottleneck} onChange={(e) => setBottleneck(e.target.value)}
              aria-describedby={describedBy('bottleneck')} aria-invalid={!!errors.bottleneck}
            />
            {errors.bottleneck && <span className="field-error" id="bottleneck-error">{errors.bottleneck}</span>}
          </div>

          <div className="hp" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input
              id="website" name="website" type="text" tabIndex={-1} autoComplete="off"
              value={website} onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          <label className="optin">
            <input
              type="checkbox" name="marketingOptIn"
              checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)}
            />
            <span>{OPT_IN_TEXT}</span>
          </label>

          <div>
            <button type="submit" className="cta" disabled={submitting}>
              {submitting ? 'Sending…' : 'Submit application'}
              <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
            </button>
          </div>

          {failed && (
            <div className="formfail" role="alert">
              <strong>That didn&rsquo;t go through.</strong> {failed}
              <br />
              Rather than retype it, put time straight on the calendar &mdash;{' '}
              <a href={BUSINESS.calendly} target="_blank" rel="noopener noreferrer">book a 30-minute call</a>{' '}
              &mdash; or email us at{' '}
              <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a>.
            </div>
          )}

          <p className="consent">
            By submitting, you agree to our <a href="/terms">Terms</a> and{' '}
            <a href="/privacy">Privacy Policy</a>. We&rsquo;ll use this information to respond to
            your application. We never sell your information.
          </p>
        </form>
      </div></section>
    </div>
  );
}
