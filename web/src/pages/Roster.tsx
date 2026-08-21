/**
 * Pulse — the roster.
 *
 * This replaces the old overview, which showed six stat cards, a bubble chart
 * and a commission figure, and buried the only genuinely useful thing (the
 * per-agent table) below all of it.
 *
 * The page answers one question: who do I need to talk to, and why. It opens
 * with a short priority list, then the numbers behind it, then the whole roster
 * dense enough to scan in one screen.
 *
 * Two rules it holds to, because breaking them is what made the old page
 * untrustworthy:
 *   - Every number on screen is measured. Nothing is a placeholder and nothing
 *     is derived from an assumption without saying so.
 *   - An agent it cannot resolve is shown, not dropped.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useReveal } from '../hqHooks';
import { HqShell } from '../components/hqShell';
import { loadDashboard, signOutClean } from '../lib/api';
import { initials, loadRoster, type RosterAgent } from '../lib/coachData';
import { isClosing, isOfferPlus, stageClass, isStuckStage } from '../../../shared/flags';

/* ── the line ──────────────────────────────────────────────────────────────
   Leads-per-contract worse than this is "past the line". Set per team in
   settings; the fallback is Eric's stated standard of one in thirty. */
const DEFAULT_LINE = 30;

type Health = 'past-line' | 'behind' | 'holding' | 'no-volume';

interface Row {
  agentId: string | null;
  name: string;
  leads: number;
  worked: number;
  workedPct: number;
  stuck: number;
  offers: number;
  contracts: number;
  perContract: number | null;
  lastDays: number | null;
  arch: string | null;
  archName: string | null;
  health: Health;
}

interface Priority {
  row: Row;
  reason: string;
  action: string;
  approach: string | null;
  severity: 'high' | 'medium';
}

const norm = (s: string | null | undefined) =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function healthOf(perContract: number | null, teamRate: number | null, line: number): Health {
  if (perContract === null) return 'no-volume';
  if (perContract > line) return 'past-line';
  if (teamRate !== null && perContract > teamRate * 1.12) return 'behind';
  return 'holding';
}

/* ── the priority list ─────────────────────────────────────────────────────
   Ranked on signals that are all genuinely measured today. Trend is absent on
   purpose: Follow Up Boss carries no stage history, so it cannot be computed
   without inventing it. It arrives once the weekly Hustle rows accumulate. */
function prioritise(rows: readonly Row[]): Priority[] {
  const out: Priority[] = [];

  for (const r of rows) {
    if (r.health === 'past-line') {
      out.push({
        row: r,
        severity: 'high',
        reason: r.workedPct >= 95
          ? `Worked ${r.workedPct}% of ${r.leads} leads and closed ${r.contracts}. Nothing is being dropped before the call, so the loss is on it.`
          : `One contract from ${r.leads} leads, and ${100 - r.workedPct}% of them were never worked.`,
        action: r.workedPct >= 95 ? 'Listen to a recent call before the next 1:1.' : 'Start with the untouched leads.',
        approach: approachFor(r),
      });
    } else if (r.stuck > 10) {
      out.push({
        row: r,
        severity: 'high',
        reason: `${r.stuck} of ${r.leads} leads are still sitting in Lead.`,
        action: 'Work the stuck list with them, oldest first.',
        approach: approachFor(r),
      });
    } else if (r.lastDays === null && r.leads >= 5) {
      out.push({
        row: r,
        severity: 'high',
        reason: `No 1:1 on record, and they are carrying ${r.leads} leads.`,
        action: 'Book a first one and set the cadence.',
        approach: approachFor(r),
      });
    } else if (r.lastDays !== null && r.lastDays > 45) {
      out.push({
        row: r,
        severity: 'medium',
        reason: `${r.lastDays} days since their last 1:1.`,
        action: 'Book one this week.',
        approach: approachFor(r),
      });
    } else if (r.health === 'no-volume' && r.leads < 5) {
      out.push({
        row: r,
        severity: 'medium',
        reason: `${r.leads} lead${r.leads === 1 ? '' : 's'} in this window. There is nothing here to coach from.`,
        action: 'Check how leads are being routed before anything else.',
        approach: null,
      });
    }
  }

  const rank = { high: 0, medium: 1 } as const;
  return out
    .sort((a, b) => rank[a.severity] - rank[b.severity]
      || (b.row.perContract ?? 0) - (a.row.perContract ?? 0))
    .slice(0, 4);
}

/* ── the burst ─────────────────────────────────────────────────────────────
   Two layers, and the split is the point.

   Behind: `burst-plate.webp`, a rendered image. Drawing light this good in
   code was the thing that kept coming out cheap - a real render has depth and
   colour behaviour that hand-drawn strokes do not.

   In front: a canvas carrying only what is true of this team - the ring at
   your line, and one node per agent at their own leads-per-contract. Those
   move per team, so they cannot live in the image.

   The plate is decoration and says so; every mark on top of it is measured.

   Positions are tied together: the plate's own light source sits at 19% across
   and halfway down, and the canvas uses the same origin. Swap the plate for a
   different render and those two numbers have to move with it, or the dots
   will float beside the burst instead of sitting in it. */
function Burst({ rows, line }: { rows: readonly Row[]; line: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const marks = useMemo(() => {
    const rates = rows
      .map((r) => r.perContract)
      .filter((v): v is number => v !== null);
    if (rates.length === 0) return null;

    // The line gets a fixed place on the dial and everyone is read against
    // it. Anyone worse than the line lands outside the ring, which is the
    // entire reason for drawing it this way round.
    const hi = Math.max(line, ...rates) * 1.18;
    const fan = [...rows].sort((a, b) => (b.perContract ?? -1) - (a.perContract ?? -1));
    const SPREAD = (52 * Math.PI) / 180;
    const step = fan.length > 1 ? (SPREAD * 2) / (fan.length - 1) : 0;
    const TONE: Record<Health, string> = {
      'past-line': '255, 106, 69',
      behind: '242, 178, 60',
      holding: '143, 176, 162',
      'no-volume': '110, 128, 116',
    };

    // The dial starts partway out rather than at the source. Marks drawn close
    // in land on top of the number and its caption, and a dial with a non-zero
    // origin is normal as long as the ring sits on the same scale — which it
    // does, so the reading is unchanged.
    const band = (v: number) => 0.44 + (Math.min(v, hi) / hi) * 0.56;

    return {
      spread: SPREAD,
      lineAt: band(line),
      dots: fan.map((r, i) => ({
        angle: fan.length > 1 ? -SPREAD + i * step : 0,
        // No volume has no rate to place, so it sits at the foot of the dial
        // rather than being given a number it does not have.
        at: r.perContract === null ? 0.40 : band(r.perContract),
        tone: TONE[r.health],
        faded: r.perContract === null,
      })),
    };
  }, [rows, line]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !marks) return;

    const draw = () => {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);

      const g = cv.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      // The plate's own light source sits at 19% across and halfway down the
      // render. These match it, so a dot lands on the burst rather than beside
      // it. Change one and you must change the other.
      const cx = w * 0.19, cy = h * 0.496;
      const R = w * 0.78;
      const { spread, lineAt, dots } = marks;
      const at = (a: number, f: number) =>
        [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f] as const;

      // The type sits on the left, so the plate is knocked back off it. This
      // is the only thing painted rather than drawn.
      const left = g.createLinearGradient(0, 0, w * 0.46, 0);
      left.addColorStop(0, 'rgba(7, 15, 10, 0.94)');
      left.addColorStop(0.42, 'rgba(7, 15, 10, 0.72)');
      left.addColorStop(1, 'rgba(7, 15, 10, 0)');
      g.fillStyle = left;
      g.fillRect(0, 0, w * 0.46, h);


      g.strokeStyle = 'rgba(255, 145, 116, 0.85)';
      g.lineWidth = 1.5;
      g.setLineDash([4, 5]);
      g.beginPath();
      g.arc(cx, cy, R * lineAt, -spread - 0.16, spread + 0.16);
      g.stroke();
      g.setLineDash([]);

      for (const d of dots) {
        const [x, y] = at(d.angle, d.at);
        const halo = g.createRadialGradient(x, y, 0, x, y, 13);
        halo.addColorStop(0, `rgba(${d.tone}, ${d.faded ? 0.22 : 0.42})`);
        halo.addColorStop(1, `rgba(${d.tone}, 0)`);
        g.fillStyle = halo;
        g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();

        g.fillStyle = `rgba(${d.tone}, ${d.faded ? 0.55 : 1})`;
        g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill();

        g.strokeStyle = `rgba(${d.tone}, 0.5)`;
        g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, 6.4, 0, Math.PI * 2); g.stroke();
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [marks]);

  if (!marks) return null;
  return (
    <>
      <img className="rs-plate-art" src="/burst-plate.webp" alt="" aria-hidden decoding="async" />
      <canvas className="rs-burst" ref={ref} aria-hidden />
    </>
  );
}

/* ── the strips ────────────────────────────────────────────────────────────
   One bar per agent, in the order the roster sits. Same form on all four
   supporting cards so the shape of the team is comparable between them.

   Deliberately NOT a sparkline: a sparkline claims a history, and Follow Up
   Boss carries no stage history to draw one from. */
function Strip({ values, tone }: { values: readonly number[]; tone: string }) {
  const max = Math.max(1, ...values);
  return (
    <span className={`rs-strip t-${tone}`} aria-hidden>
      {values.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(7, (v / max) * 100)}%`, opacity: v === 0 ? 0.22 : 1 }} />
      ))}
    </span>
  );
}

/** The personality angle comes from the assessment; without one, say nothing. */
function approachFor(r: Row): string | null {
  if (!r.arch) return null;
  if (r.arch === 'Striver') return 'A Striver — lead with momentum and a specific next rep, not a target.';
  if (r.arch === 'Achiever') return 'An Achiever — give them the number and the autonomy to hit it.';
  if (r.arch === 'Independent') return 'Independent — agree the outcome, then stay out of the method.';
  return null;
}

export default function Roster({
  orgName, onOpenPulse, onOpenCoach, onOpenRep,
}: {
  orgName: string;
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const line = DEFAULT_LINE;
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 }>({ key: 'perContract', dir: -1 });

  // The shell's heading is a `.reveal` element and stays hidden until this runs.
  useReveal([rows]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // The coaching roster is a separate read and is allowed to fail: a team
        // with Coach switched off still gets its pipeline.
        const [data, coach] = await Promise.all([
          loadDashboard(),
          loadRoster().catch((): RosterAgent[] => []),
        ]);
        if (!alive) return;

        // NOTE: org_settings.close_rate is a percentage, not a ratio - reading
        // it here produced "your line is 1 : 2". The per-team line needs its own
        // settings field; until it exists this holds the stated standard.

        const byName = new Map(coach.map((c) => [norm(c.name), c]));
        const bucket = new Map<string, Row>();

        for (const l of data.leads) {
          const owner = l.assigned_to?.trim();
          if (!owner) continue;
          const key = norm(owner);
          let r = bucket.get(key);
          if (!r) {
            const c = byName.get(key);
            r = {
              agentId: c?.id ?? null,
              name: owner,
              leads: 0, worked: 0, workedPct: 0, stuck: 0, offers: 0, contracts: 0,
              perContract: null,
              lastDays: c && c.lastDays < 99 ? c.lastDays : null,
              arch: c?.quad ?? null,
              archName: c?.archName ?? null,
              health: 'no-volume',
            };
            bucket.set(key, r);
          }
          r.leads += 1;
          const cls = stageClass(l.stage);
          if (isOfferPlus(cls)) r.offers += 1;
          if (isClosing(cls)) r.contracts += 1;
          if (isStuckStage(l.stage)) r.stuck += 1;
          if (l.flag !== 'zero_contact') r.worked += 1;
        }

        const list = [...bucket.values()].map((r) => ({
          ...r,
          workedPct: r.leads ? Math.round((r.worked / r.leads) * 100) : 0,
          perContract: r.contracts ? r.leads / r.contracts : null,
        }));

        const totalLeads = list.reduce((a, r) => a + r.leads, 0);
        const totalContracts = list.reduce((a, r) => a + r.contracts, 0);
        const teamRate = totalContracts ? totalLeads / totalContracts : null;

        setRows(list.map((r) => ({ ...r, health: healthOf(r.perContract, teamRate, line) })));
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Could not load the roster.');
      }
    })();
    return () => { alive = false; };
    // `line` is read inside but only as a fallback; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    if (!rows) return null;
    const leads = rows.reduce((a, r) => a + r.leads, 0);
    const worked = rows.reduce((a, r) => a + r.worked, 0);
    const contracts = rows.reduce((a, r) => a + r.contracts, 0);
    const offers = rows.reduce((a, r) => a + r.offers, 0);
    const stuck = rows.reduce((a, r) => a + r.stuck, 0);
    return {
      leads, worked, contracts, offers, stuck,
      workedPct: leads ? Math.round((worked / leads) * 100) : 0,
      perContract: contracts ? leads / contracts : null,
      pastLine: rows.filter((r) => r.health === 'past-line').length,
      stale: rows.filter((r) => r.lastDays !== null && r.lastDays > 30).length,
    };
  }, [rows]);

  const priorities = useMemo(
    () => (rows ? prioritise(rows) : []),
    [rows],
  );

  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x === null && y === null) return 0;
      if (x === null) return 1;          // no-volume always sits at the bottom
      if (y === null) return -1;
      if (typeof x === 'string' || typeof y === 'string') {
        return String(x).localeCompare(String(y)) * sort.dir * -1;
      }
      return ((y as number) - (x as number)) * sort.dir;
    });
  }, [rows, sort]);

  // One fixed order for every strip, so the four cards are comparable to each
  // other rather than each being sorted by its own metric.
  const strip = useMemo(
    () => (rows ? [...rows].sort((a, b) => b.leads - a.leads) : []),
    [rows],
  );

  const nav = { onOpenPulse, onOpenCoach, onOpenRep };

  // Button-in-button: the arrow never sits naked beside the label.
  const top = rows && rows.length ? prioritise(rows)[0] : undefined;
  const cta = top ? (
    <button className="rs-cta" onClick={() => setOpen(top.row)}>
      Prep the 1:1 with {top.row.name.split(' ')[0]}
      <span aria-hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  ) : undefined;
  // The shell already renders an eyebrow and an h1. The page used to render its
  // own as well, which stacked two headings. One heading, and it says the thing
  // that actually matters this week.
  const wrap = (body: React.ReactNode, title: string) => (
    <div className="tru-dark">
      <HqShell
        orgName={orgName}
        eyebrow={`${orgName} · rolling window`}
        title={title}
        context={cta}
        onSignOut={() => signOutClean()}
        nav={nav}
      >
        {body}
      </HqShell>
    </div>
  );

  if (err) return wrap(<div className="ps-emptyview"><h3>{err}</h3></div>, 'Pulse');
  if (!rows || !totals) return wrap(<div className="spinner" />, 'Pulse');

  // Fit the axis to what is actually on screen, with a little air either side,
  // so the dots spread across the bar instead of bunching at one end.
  const rates = rows.map((r) => r.perContract).filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.min(line, ...rates) - 4);
  const hi = Math.max(line, ...rates) + 4;
  const scale = (v: number) => Math.max(0, Math.min(100, ((v - lo) / Math.max(1, hi - lo)) * 100));
  const th = (key: keyof Row, label: string) => (
    <th
      className={`sortable${sort.key === key ? ' on' : ''}`}
      tabIndex={0}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 })); } }}
    >
      {label}<span className="sortcaret">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
    </th>
  );

  return wrap(
    <>
      <div className="rs-canvas">
      {/* ONE surface. Not a stack of floating cards separated by gaps - that
          reads as unfinished no matter how well each card is drawn. Everything
          below sits inside a single enclosure divided by hairlines, and the
          emphasis is deliberately unequal rather than a row of equal squares. */}

        {/* Unequal on purpose. A row of six identical cards is the pattern
            that reads as generated; these are one lead card, one alert card,
            and four supporting ones sharing the remaining width. */}
        <div className="rs-stats">
          <div className="rs-plate rs-stat rs-s-lead">
            <Burst rows={rows} line={line} />
            <span className="k">Leads per contract</span>
            <span className="v">{totals.perContract ? "1 : " + Math.round(totals.perContract) : "\u2014"}</span>
            <span className="u">your line is 1 : {line}</span>
          </div>
          <div className={totals.pastLine > 0 ? "rs-plate rs-stat rs-s-alert hot" : "rs-plate rs-stat rs-s-alert"}>
            <span className="k">Past your line</span>
            <span className="v">{totals.pastLine}</span>
            <span className="u">{totals.stale ? totals.stale + " stale 1:1s" : "nobody drifting"}</span>
          </div>
          {([
            ["rs-s-a", "Leads in play", String(totals.leads), "all sources", "sea", strip.map((r) => r.leads)],
            ["rs-s-b", "Worked", totals.workedPct + "%", totals.worked + " of " + totals.leads, "sea", strip.map((r) => r.workedPct)],
            ["rs-s-c", "Under contract", String(totals.contracts), "this window", "amber", strip.map((r) => r.contracts)],
            ["rs-s-d", "Still in Lead", String(totals.stuck), totals.stuck ? "48h+ untouched" : "nothing sitting", "ember", strip.map((r) => r.stuck)],
          ] as const).map(([cls, k, v, u, tone, values]) => (
            <div className={"rs-plate rs-stat " + cls} key={k}>
              <span className="k">{k}</span>
              <span className="rs-stat-row">
                <span className="v">{v}</span>
                <Strip values={values} tone={tone} />
              </span>
              <span className="u">{u}</span>
            </div>
          ))}
        </div>

        {/* The people who need you are not a separate card list stacked above a
            table - that printed every name twice. Same list, opened. */}
        {priorities.length > 0 && (
          <div className="rs-focus">
            {priorities.map((p, i) => (
              <article
                key={p.row.name}
                className={p.severity === "high" ? "rs-plate rs-fr crit" : "rs-plate rs-fr"}
                tabIndex={0}
                onClick={() => setOpen(p.row)}
                onKeyDown={(e) => { if (e.key === "Enter") setOpen(p.row); }}
              >
                <span className={"rs-av h-" + p.row.health}>{initials(p.row.name)}</span>
                <div className="rs-fr-body">
                  <div className="rs-fr-top">
                    <span className="rs-fr-name">{p.row.name}</span>
                    <span className="rs-fr-idx">{i + 1} of {priorities.length}</span>
                  </div>
                  <p className="rs-fr-why">{p.reason}</p>
                  <p className="rs-fr-do"><b>Do:</b> {p.action}{p.approach ? <em> {p.approach}</em> : null}</p>
                </div>
              </article>
            ))}
          </div>
        )}

        {priorities.length === 0 && (
          <div className="rs-plate rs-clear">
            <i />
            <p>
              <b>Nothing needs you this week.</b> Every agent is inside one in {line},
              everyone has had a 1:1 in the last 45 days, and no lead has been left untouched.
            </p>
          </div>
        )}

        <div className="rs-restbar">
          <span>The rest of the floor</span>
          <span className="rs-restbar-note">bar is leads per contract, the mark is your line at 1 : {line}</span>
        </div>

        <div className="rs-plate rs-table">
          <table className="tru-table">
            <thead>
              <tr>
                {th("name", "Agent")}{th("leads", "Leads")}{th("workedPct", "Worked")}
                {th("stuck", "In Lead")}{th("offers", "Offers")}{th("contracts", "Contracts")}
                {th("perContract", "Leads per contract")}{th("lastDays", "Last 1:1")}
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {sorted.filter((r) => !priorities.some((p) => p.row.name === r.name)).map((r) => (
                <tr key={r.name} className="rowlink" tabIndex={0}
                    onClick={() => setOpen(r)}
                    onKeyDown={(e) => { if (e.key === "Enter") setOpen(r); }}>
                  <td>
                    <div className="rs-who">
                      <span className={"rs-av h-" + r.health}>{initials(r.name)}</span>
                      <div>
                        <div className="cell-name">{r.name}</div>
                        <div className="rs-sub2">{r.archName ?? "Not assessed"} &middot; {r.leads} leads</div>
                      </div>
                    </div>
                  </td>
                  <td>{r.leads}</td>
                  <td className={r.workedPct < 90 ? "cell-warn" : ""}>{r.workedPct}%</td>
                  <td className={r.stuck > 10 ? "cell-warn" : ""}>{r.stuck || "\u2014"}</td>
                  <td>{r.offers || "\u2014"}</td>
                  <td>{r.contracts || "\u2014"}</td>
                  <td>
                    <div className="rs-rate">
                      <b className={r.health === "past-line" ? "cell-warn" : ""}>
                        {r.perContract ? "1 : " + Math.round(r.perContract) : "\u2014"}
                      </b>
                      <span className="rs-scale">
                        <hr />
                        <u style={{ left: scale(line) + "%" }} />
                        {r.perContract !== null && (
                          <i style={{ left: scale(r.perContract) + "%" }} className={"h-" + r.health} />
                        )}
                      </span>
                    </div>
                  </td>
                  <td className={r.lastDays !== null && r.lastDays > 45 ? "cell-warn" : ""}>
                    {r.lastDays === null ? "\u2014" : r.lastDays + "d"}
                  </td>
                  <td><span className={"rs-tag h-" + r.health}>{
                    r.health === "past-line" ? "past the line"
                      : r.health === "behind" ? "behind team"
                        : r.health === "no-volume" ? "no volume" : "holding"
                  }</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Team</td><td><b>{totals.leads}</b></td><td><b>{totals.workedPct}%</b></td>
                <td><b>{totals.stuck}</b></td><td><b>{totals.offers}</b></td><td><b>{totals.contracts}</b></td>
                <td><b>{totals.perContract ? "1 : " + Math.round(totals.perContract) : "\u2014"}</b></td>
                <td><b>{totals.stale} stale</b></td><td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {open && (
        <>
          <div className="rs-scrim on" onClick={() => setOpen(null)} />
          <aside className="rs-pane on">
            <div className="rs-pane-h">
              <button className="x" onClick={() => setOpen(null)} aria-label="Close">✕</button>
              <h3>{open.name}</h3>
              <p>{open.archName ?? 'Not assessed'} · {open.leads} leads</p>
            </div>
            <div className="rs-pane-b">
              <div className="rs-grp">
                <div className="rs-grp-k">Pipeline</div>
                {[
                  ['Leads assigned', String(open.leads)],
                  ['Worked', `${open.workedPct}%`],
                  ['Sitting in Lead', open.stuck ? String(open.stuck) : 'none'],
                  ['Reached an offer', open.offers ? String(open.offers) : 'none'],
                  ['Under contract', open.contracts ? String(open.contracts) : 'none'],
                  ['Leads per contract', open.perContract ? `1 : ${Math.round(open.perContract)}` : '—'],
                ].map(([k, v]) => (
                  <div className="rs-ln" key={k}><s>{k}</s><b>{v}</b></div>
                ))}
              </div>
              <div className="rs-grp">
                <div className="rs-grp-k">Coaching</div>
                <div className="rs-ln"><s>Archetype</s><b>{open.arch ?? '—'}</b></div>
                <div className="rs-ln"><s>Last 1:1</s><b>{open.lastDays === null ? 'no record' : `${open.lastDays} days ago`}</b></div>
                {approachFor(open) && <p className="rs-msg">{approachFor(open)}</p>}
                {open.agentId
                  ? <a className="hqbtn hqbtn-primary rs-go" href={`#/coach/${open.agentId}`}>Open {open.name.split(' ')[0]} in Coach</a>
                  : <p className="rs-msg">No coaching record is linked to this name, so there is nothing to open.</p>}
              </div>
            </div>
          </aside>
        </>
      )}
    </>,
    priorities.length === 0
      ? 'Nobody is past your line.'
      : `${priorities.length} ${priorities.length === 1 ? 'conversation' : 'conversations'} this week.`,
  );
}
