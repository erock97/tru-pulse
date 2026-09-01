/**
 * "New contract" — build a genuine review-only draft envelope in TruSign.
 *
 * Two paths, ported from TRU OS's DraftWizard:
 *
 *   From an agreement — pick a stored template, name the other party, fill
 *   its blanks. The wording is already fixed and already approved; this only
 *   decides who signs it and what goes in the gaps.
 *
 *   Write it out — a free-text contract: title, terms, the full draft text.
 *
 * Neither path sends anything. Sending is a separate, approve-gated action on
 * the page behind this wizard; the worker enforces that regardless of what
 * this form does.
 *
 * TRU OS also had a third path (delegate to a local drafting agent). It rode
 * on hardware on Eric's desk and was deliberately not ported.
 */

import { useEffect, useRef, useState } from 'react';

import {
  contractTemplate, contractTemplates, prepareContractDraft,
  type ContractTemplateDetail, type ContractTemplateSummary,
} from '../../lib/api';
import {
  applyDerivedBlanks, assembleRecipients, BLANK_LABELS, defaultValue, DERIVED_BLANKS,
  humanizeKey, missingRequiredPlaceholders, parseFieldLines, parseRecipientLines,
  PER_DEAL_FEES, PLANS, readClientBook, recallClient, rememberClient, retainerForPlan,
  roleIsFixed, type ClientBook, type WizardPerson,
} from '../../lib/contractsForm';

interface TemplateFormState {
  client: string;
  team: string;
  durationDays: string;
  values: Record<string, string>;
  people: Record<string, WizardPerson>;
  extraSigners: string[];
}

interface ManualFormState {
  title: string;
  client: string;
  team: string;
  contractType: string;
  durationDays: string;
  signerName: string;
  signerEmail: string;
  additionalRecipients: string;
  terms: string;
  fields: string;
  draftText: string;
}

export function DraftWizard({
  teams, onClose, onDone,
}: {
  /** Team names already visible in the app, for the team box's suggestions.
   *  Free text is accepted too — a new client has no envelope yet. */
  teams: string[];
  onClose: () => void;
  /** A draft was created — the parent should refresh its overview. */
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'template' | 'manual'>('template');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // One requestId per submission attempt: the worker dedupes on it, so a retry
  // after a timeout cannot create a second envelope. Regenerated only after a
  // SUCCESS — a second deliberate draft in the same wizard must not be
  // swallowed as a "retry" of the first.
  const requestId = useRef(crypto.randomUUID());

  const [templates, setTemplates] = useState<ContractTemplateSummary[]>([]);
  const [template, setTemplate] = useState<ContractTemplateDetail | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [tf, setTf] = useState<TemplateFormState>({
    client: '', team: '', durationDays: '90', values: {}, people: {}, extraSigners: [],
  });
  const [mf, setMf] = useState<ManualFormState>({
    title: '', client: '', team: '', contractType: '', durationDays: '90',
    signerName: '', signerEmail: '', additionalRecipients: '', terms: '', fields: '', draftText: '',
  });

  const [book, setBook] = useState<ClientBook>(() => readClientBook());

  // Load once, the first time the template tab is opened. Nothing about the
  // fetch may appear in the dependency list: setting the loading flag would
  // re-run the effect, and the re-run's cleanup abandons the request that is
  // still in flight — the reply lands, is discarded as stale, and the panel
  // says "Loading templates…" forever. (That exact bug shipped in TRU OS; the
  // ref guard is what fixed it.)
  const templatesRequested = useRef(false);
  useEffect(() => {
    if (mode !== 'template' || templatesRequested.current) return;
    templatesRequested.current = true;
    let alive = true;
    setLoadingTemplates(true);
    void contractTemplates().then((r) => {
      if (!alive) return;
      if (r.ok) setTemplates(r.templates);
      else setTemplateError(r.error);
      setLoadingTemplates(false);
    });
    return () => { alive = false; };
  }, [mode]);

  // Typing or choosing a client that has been used before brings back
  // everything that was filled in for them last time.
  const onRecallClient = (client: string) => {
    const remembered = recallClient(book, client);
    setTf((c) => ({
      ...c,
      client,
      ...(remembered
        ? {
            team: remembered.team || c.team,
            values: { ...c.values, ...remembered.values },
            people: { ...c.people, ...remembered.people },
          }
        : {}),
    }));
  };

  const pickTemplate = async (templateId: string) => {
    setTemplate(null);
    setTemplateError(null);
    setTf((c) => ({ ...c, extraSigners: [] }));
    const r = await contractTemplate(templateId);
    if (!r.ok) { setTemplateError(r.error); return; }
    const detail = r.template;
    setTemplate(detail);
    // Seed the blanks that are the same every time, and anything already
    // known about whoever is in the client box.
    setTf((c) => {
      const remembered = recallClient(book, c.client);
      const seeded: Record<string, string> = {};
      for (const placeholder of detail.placeholders) {
        seeded[placeholder.key] =
          remembered?.values?.[placeholder.key] ?? c.values[placeholder.key] ?? defaultValue(placeholder.key);
      }
      return {
        ...c,
        team: c.team || remembered?.team || detail.team || '',
        durationDays: detail.defaultDurationDays ? String(detail.defaultDurationDays) : c.durationDays,
        values: seeded,
        people: remembered?.people ?? c.people,
      };
    });
  };

  const setValue = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const next = event.target.value;
    setTf((c) => ({
      ...c,
      values: {
        ...c.values,
        [key]: next,
        // The plan carries its own price. Picking one fills the retainer;
        // overtyping the retainer afterwards still wins.
        ...(key === 'plan_name'
          ? { monthly_retainer: retainerForPlan(next) ?? c.values.monthly_retainer ?? '' }
          : {}),
      },
    }));
  };

  const setPerson = (roleKey: string, field: 'name' | 'email') =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setTf((c) => ({
        ...c,
        people: { ...c.people, [roleKey]: { ...(c.people[roleKey] || {}), [field]: next } },
      }));
    };

  // Stamping a stored agreement: the document and its wording already exist,
  // so this only carries who signs it and what fills its blanks.
  const submitTemplate = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (!template) throw new Error('Choose an agreement first.');
      if (!tf.client.trim()) throw new Error('Say who the agreement is with.');
      const assembled = assembleRecipients(template.roles, tf.people, tf.extraSigners);
      if (!assembled.ok) throw new Error(assembled.error);
      const values = applyDerivedBlanks(tf.values, tf);
      const missing = missingRequiredPlaceholders(template.placeholders, values, tf.extraSigners.length > 0);
      if (missing.length) {
        throw new Error(`Still blank: ${missing.map((p) => BLANK_LABELS[p.key] || humanizeKey(p.key)).join(', ')}.`);
      }
      const r = await prepareContractDraft({
        requestId: requestId.current,
        client: tf.client.trim(),
        team: tf.team.trim() || null,
        contractType: template.contractType,
        templateId: template.id,
        durationDays: tf.durationDays ? Number(tf.durationDays) : null,
        fields: values,
        recipients: assembled.recipients,
        summary: `${template.name} for ${tf.client.trim()}.`,
      });
      if (!r.ok) throw new Error(r.error);
      rememberClient({ client: tf.client.trim(), team: tf.team.trim(), values, people: tf.people });
      setBook(readClientBook());
      requestId.current = crypto.randomUUID();
      setResult({ ok: true, text: `${r.envelope.title || template.name} is drafted and waiting for your review. Nothing was sent.` });
      onDone();
    } catch (err) {
      setResult({ ok: false, text: (err as Error)?.message || 'Draft preparation failed.' });
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async () => {
    setBusy(true);
    setResult(null);
    try {
      // Without a template there is no stored wording — the title, the terms
      // and the full text ARE the contract, so all three are required here
      // rather than letting a half-typed form make a server round trip.
      if (!mf.title.trim()) throw new Error('The envelope needs a title.');
      if (!mf.terms.trim()) throw new Error('Terms are required for a written-out contract.');
      if (!mf.draftText.trim()) throw new Error('The complete contract text is required.');
      const r = await prepareContractDraft({
        requestId: requestId.current,
        title: mf.title.trim(),
        client: mf.client.trim(),
        team: mf.team.trim() || null,
        contractType: mf.contractType.trim(),
        durationDays: mf.durationDays ? Number(mf.durationDays) : null,
        terms: mf.terms.trim(),
        fields: parseFieldLines(mf.fields),
        recipients: [
          { name: mf.signerName.trim(), email: mf.signerEmail.trim(), role: 'signer' },
          ...parseRecipientLines(mf.additionalRecipients),
        ],
        summary: `Manual ${mf.contractType.trim()} draft for ${mf.client.trim()}.`,
        draftText: mf.draftText.trim(),
      });
      if (!r.ok) throw new Error(r.error);
      requestId.current = crypto.randomUUID();
      setResult({ ok: true, text: `${mf.title.trim()} is drafted and waiting for your review. Nothing was sent.` });
      onDone();
    } catch (err) {
      setResult({ ok: false, text: (err as Error)?.message || 'Draft preparation failed.' });
    } finally {
      setBusy(false);
    }
  };

  const setM = (key: keyof ManualFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setMf((c) => ({ ...c, [key]: event.target.value }));

  const openRoles = (template?.roles ?? []).filter((role) => !roleIsFixed(role) && !role.optional);
  const optionalRoles = (template?.roles ?? []).filter((role) => !roleIsFixed(role) && role.optional);
  const fixedRoles = (template?.roles ?? []).filter(roleIsFixed);
  // Blanks the form derives from the client and signer boxes are never shown —
  // asking for them again is how the same name gets typed three times.
  const askedPlaceholders = (template?.placeholders ?? []).filter((p) => !DERIVED_BLANKS[p.key]);

  return (
    <div className="rp-mgmt-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rp-mgmt-panel" role="dialog" aria-label="New contract">
        <div className="rp-mgmt-head">
          <div>
            <h2 style={{ margin: 0 }}>New contract</h2>
            <p className="mny-modal-sub">
              Builds a real draft envelope in TruSign for your review. Nothing here sends anything.
            </p>
          </div>
          <div className="rp-mgmt-headbtns">
            <button type="button" className="mny-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="mny-modes">
          <button type="button" className={`mny-mode ${mode === 'template' ? 'on' : ''}`} onClick={() => setMode('template')}>
            From an agreement
          </button>
          <button type="button" className={`mny-mode ${mode === 'manual' ? 'on' : ''}`} onClick={() => setMode('manual')}>
            Write it out
          </button>
        </div>

        {mode === 'template' ? (
          <>
            <div className="ctr-templates">
              {loadingTemplates && !templates.length && <div className="mny-note">Loading templates…</div>}
              {templateError && <div className="mny-err">{templateError}</div>}
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`ctr-template ${template?.id === t.id ? 'on' : ''}`}
                  onClick={() => void pickTemplate(t.id)}
                >
                  <span className="ctr-template-name">{t.name}</span>
                  {t.description && <span className="ctr-template-desc">{t.description}</span>}
                  <span className="ctr-template-meta">
                    {[t.contractType, t.defaultDurationDays ? `${t.defaultDurationDays} days` : null]
                      .filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
              {!loadingTemplates && !templates.length && !templateError && (
                <div className="mny-note">No templates are stored in TruSign yet.</div>
              )}
            </div>

            {template && (
              <>
                <div className="mny-row">
                  <div className="grow mny-field">
                    <label>Who the agreement is with</label>
                    <input
                      value={tf.client}
                      list="ctr-client-book"
                      placeholder="Brokerage or team"
                      onChange={(e) => onRecallClient(e.target.value)}
                    />
                    <datalist id="ctr-client-book">
                      {Object.values(book).map((entry) => (
                        <option key={entry.client} value={entry.client} />
                      ))}
                    </datalist>
                  </div>
                  <div className="grow mny-field">
                    <label>Tag it to one of your teams (optional)</label>
                    <input
                      value={tf.team}
                      list="ctr-teams"
                      placeholder="Team"
                      onChange={(e) => setTf((c) => ({ ...c, team: e.target.value }))}
                    />
                    <datalist id="ctr-teams">
                      {teams.map((t) => <option key={t} value={t} />)}
                    </datalist>
                  </div>
                </div>

                {openRoles.map((role) => (
                  <div key={role.roleKey}>
                    <div className="ctr-role-label">
                      {role.label} — signs {role.routingOrder === 1 ? 'first' : `#${role.routingOrder}`}
                    </div>
                    <div className="mny-row">
                      <div className="grow mny-field">
                        <label>Printed name</label>
                        <input value={tf.people[role.roleKey]?.name || ''} onChange={setPerson(role.roleKey, 'name')} />
                      </div>
                      <div className="grow mny-field">
                        <label>Email</label>
                        <input type="email" value={tf.people[role.roleKey]?.email || ''} onChange={setPerson(role.roleKey, 'email')} />
                      </div>
                    </div>
                  </div>
                ))}

                {optionalRoles.map((role) =>
                  tf.extraSigners.includes(role.roleKey) ? (
                    <div key={role.roleKey}>
                      <div className="ctr-role-label">
                        {role.label}
                        <button
                          type="button"
                          className="mny-link"
                          style={{ marginLeft: 8 }}
                          onClick={() => setTf((c) => ({ ...c, extraSigners: c.extraSigners.filter((k) => k !== role.roleKey) }))}
                        >
                          remove
                        </button>
                      </div>
                      <div className="mny-row">
                        <div className="grow mny-field">
                          <label>Their printed name</label>
                          <input value={tf.people[role.roleKey]?.name || ''} onChange={setPerson(role.roleKey, 'name')} />
                        </div>
                        <div className="grow mny-field">
                          <label>Their email</label>
                          <input type="email" value={tf.people[role.roleKey]?.email || ''} onChange={setPerson(role.roleKey, 'email')} />
                        </div>
                      </div>
                      <div className="mny-field">
                        <label>Their title (optional)</label>
                        <input
                          value={tf.values[`${role.roleKey}_title`] || tf.values.client_signer_2_title || ''}
                          onChange={(e) => setTf((c) => ({ ...c, values: { ...c.values, client_signer_2_title: e.target.value } }))}
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      key={role.roleKey}
                      type="button"
                      className="mny-link"
                      onClick={() => setTf((c) => ({ ...c, extraSigners: [...c.extraSigners, role.roleKey] }))}
                    >
                      + add a second signer on their side
                    </button>
                  ),
                )}

                {fixedRoles.length > 0 && (
                  <div className="mny-sub" style={{ margin: '8px 0' }}>
                    Also signs: {fixedRoles.map((r) => `${r.fixedName} (${r.fixedEmail})`).join(' · ')}
                  </div>
                )}

                {askedPlaceholders.length > 0 && (
                  <div className="ctr-role-label">The blanks in this agreement</div>
                )}
                <div className="ctr-blanks">
                  {askedPlaceholders.map((p) => {
                    if (p.key === 'plan_name') {
                      return (
                        <div className="mny-field" key={p.key}>
                          <label>Service plan</label>
                          <select value={tf.values[p.key] || ''} onChange={setValue(p.key)}>
                            <option value="">Pick a plan</option>
                            {PLANS.map((plan) => (
                              <option key={plan.name} value={plan.name}>
                                {plan.name}{plan.retainer ? ` — ${plan.retainer}/mo` : ' — custom'}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    }
                    return (
                      <div className="mny-field" key={p.key}>
                        <label>
                          {BLANK_LABELS[p.key] || humanizeKey(p.key)}{p.required ? '' : ' (optional)'}
                        </label>
                        <input
                          value={tf.values[p.key] || ''}
                          list={p.key === 'per_deal_fee' ? 'ctr-per-deal-fees' : undefined}
                          onChange={setValue(p.key)}
                        />
                      </div>
                    );
                  })}
                  <datalist id="ctr-per-deal-fees">
                    {PER_DEAL_FEES.map((fee) => <option key={fee} value={fee} />)}
                  </datalist>
                </div>
              </>
            )}

            <div className="ctr-warn">
              This stamps the stored agreement into a draft envelope for your review. It does not send it.
            </div>
          </>
        ) : (
          <>
            <div className="mny-row">
              <div className="grow mny-field">
                <label>Envelope title</label>
                <input value={mf.title} onChange={setM('title')} />
              </div>
              <div className="grow mny-field">
                <label>Contract type</label>
                <input value={mf.contractType} onChange={setM('contractType')} placeholder="e.g. consulting retainer" />
              </div>
            </div>
            <div className="mny-row">
              <div className="grow mny-field">
                <label>Who the agreement is with</label>
                <input value={mf.client} onChange={setM('client')} placeholder="Brokerage or team" />
              </div>
              <div className="grow mny-field">
                <label>Team (optional)</label>
                <input value={mf.team} list="ctr-teams-manual" onChange={setM('team')} />
                <datalist id="ctr-teams-manual">
                  {teams.map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div className="mny-field" style={{ maxWidth: 130 }}>
                <label>Duration (days)</label>
                <input type="number" min={1} max={3650} value={mf.durationDays} onChange={setM('durationDays')} />
              </div>
            </div>
            <div className="mny-row">
              <div className="grow mny-field">
                <label>Signer name</label>
                <input value={mf.signerName} onChange={setM('signerName')} />
              </div>
              <div className="grow mny-field">
                <label>Signer email</label>
                <input type="email" value={mf.signerEmail} onChange={setM('signerEmail')} />
              </div>
            </div>
            <div className="mny-field">
              <label>Additional recipients (optional)</label>
              <textarea
                rows={2}
                value={mf.additionalRecipients}
                onChange={setM('additionalRecipients')}
                placeholder={'One per line: Name | email | signer, approver, or cc'}
              />
            </div>
            <div className="mny-field">
              <label>Terms and commercial instructions</label>
              <textarea rows={4} value={mf.terms} onChange={setM('terms')} />
            </div>
            <div className="mny-field">
              <label>Known fields (optional)</label>
              <textarea rows={3} value={mf.fields} onChange={setM('fields')} placeholder={'One per line, e.g. Fee: $5,000'} />
            </div>
            <div className="mny-field">
              <label>Complete contract text</label>
              <textarea rows={10} value={mf.draftText} onChange={setM('draftText')} />
            </div>
            <div className="ctr-warn">
              This creates a genuine draft envelope and review PDF in TruSign.
              It does not send, execute, void, or create billing.
            </div>
          </>
        )}

        {result && <div className={result.ok ? 'mny-ok' : 'mny-err'}>{result.text}</div>}

        <div className="mny-foot">
          <button
            type="button"
            className="btn"
            disabled={busy || (mode === 'template' && !template)}
            onClick={() => void (mode === 'template' ? submitTemplate() : submitManual())}
          >
            {busy ? 'Preparing…' : 'Draft it for review'}
          </button>
        </div>
      </div>
    </div>
  );
}
