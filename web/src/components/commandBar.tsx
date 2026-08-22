/**
 * THE COMMAND BAR — ⌘K anywhere in TRU HQ.
 *
 * Two things prompted this. Signature Realty carries 108 people, and today the
 * only way to reach one of them is to pick a tab, then scroll a table. And a
 * deterministic UI review found twelve places in this app where a row can be
 * clicked but not reached with a keyboard — the product had no keyboard story
 * at all.
 *
 * So this is both: the fastest way to reach a person, and the first thing here
 * built keyboard-first. Type a name, hit Enter, land on them.
 *
 * It loads people lazily, on first open, and degrades rather than fails: an
 * agent (not a leader) has no right to the roster, so that read 403s and the
 * bar quietly becomes navigation-only instead of showing an error nobody can
 * act on.
 *
 * Matching is deliberately simple — substring, with word-starts ranked above
 * mid-word hits. Fuzzy matching sounds better than it reads: on a list of
 * colleagues' names, "an" surfacing "Ana" above "Bryant" is what you expect,
 * and anything cleverer starts guessing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { loadTeamRoster } from '../lib/api';

export interface Cmd {
  id: string;
  label: string;
  hint?: string;
  group: 'Go to' | 'People' | 'Actions';
  run: () => void;
}

/** Word-starts beat mid-word hits; earlier beats later. Returns null for no match. */
function score(haystack: string, needle: string): number | null {
  const h = haystack.toLowerCase();
  const i = h.indexOf(needle);
  if (i < 0) return null;
  const atWordStart = i === 0 || /[\s.@-]/.test(h[i - 1]);
  return (atWordStart ? 0 : 500) + i;
}

export function CommandBar({
  onOpenPulse, onOpenCoach, onOpenRep, onOpenTeam, onSignOut,
}: {
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
  onOpenTeam?: () => void;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [people, setPeople] = useState<Cmd[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Where focus was before we stole it, so Esc gives it back. */
  const cameFrom = useRef<HTMLElement | null>(null);

  // ⌘K / Ctrl-K from anywhere. Deliberately ignored while typing in a field, so
  // it can never eat a keystroke meant for a search box or a note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && !typing) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // People load once, on first open — never on page load, because most sessions
  // never press ⌘K and this is one more request against the roster.
  useEffect(() => {
    if (!open || people !== null) return;
    let live = true;
    loadTeamRoster()
      .then((rows) => {
        if (!live) return;
        setPeople(rows.filter((m) => !m.excluded).map((m) => ({
          id: `p:${m.id}`,
          label: m.name,
          hint: m.email ?? 'no email on file',
          group: 'People' as const,
          run: () => { window.location.hash = `/coach/${m.id}`; },
        })));
      })
      // A plain agent has no right to the roster. Navigation still works.
      .catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [open, people]);

  useEffect(() => {
    if (open) {
      cameFrom.current = document.activeElement as HTMLElement | null;
      setQ(''); setSel(0);
      // After paint, or the input is not in the document yet.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      cameFrom.current?.focus?.();
    }
  }, [open]);

  const all = useMemo<Cmd[]>(() => {
    const nav: Cmd[] = [
      { id: 'n:pulse', label: 'Pulse', hint: 'the floor, lead to contract', group: 'Go to', run: onOpenPulse },
      { id: 'n:coach', label: 'Coach', hint: 'who needs a conversation', group: 'Go to', run: onOpenCoach },
      { id: 'n:rep', label: 'Rep', hint: 'certification progress', group: 'Go to', run: onOpenRep },
    ];
    if (onOpenTeam) nav.push({ id: 'n:team', label: 'Team', hint: 'who is on the platform', group: 'Go to', run: onOpenTeam });
    const actions: Cmd[] = [];
    if (onSignOut) actions.push({ id: 'a:out', label: 'Sign out', group: 'Actions', run: onSignOut });
    return [...nav, ...(people ?? []), ...actions];
  }, [people, onOpenPulse, onOpenCoach, onOpenRep, onOpenTeam, onSignOut]);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all.slice(0, 12);
    return all
      .map((c) => {
        const s = Math.min(
          score(c.label, needle) ?? Infinity,
          (c.hint ? score(c.hint, needle) ?? Infinity : Infinity) + 1000,
        );
        return { c, s };
      })
      .filter((x) => x.s !== Infinity)
      .sort((a, b) => a.s - b.s)
      .slice(0, 12)
      .map((x) => x.c);
  }, [all, q]);

  useEffect(() => { setSel(0); }, [q]);

  const fire = useCallback((c: Cmd | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  }, []);

  function onFieldKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % Math.max(1, hits.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + hits.length) % Math.max(1, hits.length)); }
    else if (e.key === 'Enter') { e.preventDefault(); fire(hits[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  }

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-sel="1"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel, hits]);

  if (!open) {
    return (
      <button className="cb-hint" onClick={() => setOpen(true)} aria-label="Open the command bar">
        <span>Search</span><kbd>⌘K</kbd>
      </button>
    );
  }

  let lastGroup = '';
  return (
    <div className="cb-scrim" onMouseDown={() => setOpen(false)}>
      <div
        className="cb"
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cb-field">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.7" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onFieldKey}
            placeholder="Jump to a person, a tab, an action…"
            aria-label="Search TRU HQ"
            aria-activedescendant={hits[sel] ? `cb-${hits[sel].id}` : undefined}
            aria-controls="cb-list"
            role="combobox"
            aria-expanded="true"
          />
          <kbd>esc</kbd>
        </div>

        <div className="cb-list" id="cb-list" role="listbox" ref={listRef}>
          {hits.length === 0 && (
            <p className="cb-none">
              {people === null ? 'Reading your team…' : <>Nothing matches “{q}”.</>}
            </p>
          )}
          {hits.map((c, i) => {
            const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
            return (
              <div key={c.id}>
                {head && <div className="cb-group">{head}</div>}
                <div
                  id={`cb-${c.id}`}
                  role="option"
                  aria-selected={i === sel}
                  data-sel={i === sel ? '1' : '0'}
                  className={i === sel ? 'cb-row is-sel' : 'cb-row'}
                  onMouseMove={() => setSel(i)}
                  onClick={() => fire(c)}
                >
                  <span className="cb-label">{c.label}</span>
                  {c.hint && <span className="cb-sub">{c.hint}</span>}
                  <span className="cb-go" aria-hidden>↵</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="cb-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
          {people !== null && people.length > 0 && <span className="cb-count">{people.length} people</span>}
        </div>
      </div>
    </div>
  );
}
