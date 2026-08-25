// Rules 3-10 of the Hermes daily handoff: turning overlapping daily reports
// into a ninety-day view that does not repeat itself.
//
// Hermes sends a report every morning covering the previous seven days, so the
// same call arrives seven mornings running. Absorbed naively, one conversation
// becomes seven occurrences, every recurrence threshold stops meaning anything,
// and a leader hears the same thing every day for a week.
//
// Two identities from the payload do the work, and neither is inferred here:
//
//   findingId   Hashed from team + agent + contact + timestamp + channel + the
//               normalised quote. The same evidence always hashes the same, so
//               "seen this already" is an exact test. It is the primary key of
//               the evidence table, which makes rule 3 a property of the
//               schema rather than something a caller has to remember.
//
//   patternKey  One of thirteen fixed coaching categories, chosen from a global
//               taxonomy rather than from wording. Stable across runs and
//               weeks, so a reworded explanation is still the same pattern.
//
// An earlier version of this guessed both from phrasing. It guessed wrong often
// enough to matter, and all of that is now deleted.

import type { Db } from './db.js';
import type { CoachBrief } from '../../shared/coachBrief.js';
import { isIgnoredAgent } from '../../shared/coachBrief.js';

export interface AbsorbResult {
  patterns: number;
  newFindings: number;
  duplicateFindings: number;
  ignoredAgents: number;
  windowAdvanced: boolean;
}

/**
 * Absorb one ACCEPTED report into the ninety-day view.
 *
 * Only ever called for a report that published — rule 6 turns on the difference
 * between accepted and merely received, and advancing the window for a report
 * that was rejected would have the app claim a freshness it does not have.
 */
export async function absorbReport(
  database: Db,
  team: { id: string; org_id: string },
  brief: CoachBrief,
  agentLinks: Record<string, string> = {},
): Promise<AbsorbResult> {
  const out: AbsorbResult = {
    patterns: 0, newFindings: 0, duplicateFindings: 0,
    ignoredAgents: 0, windowAdvanced: false,
  };

  // Findings by their durable id, so an opportunity's findingIds resolve
  // without depending on findingIndex — which only means anything inside one
  // report and shifts as the window rolls.
  const byId = new Map<string, any>();
  const byIndex = new Map<number, any>();
  for (const f of brief.findings ?? []) {
    if (f.findingId) byId.set(f.findingId, f);
    byIndex.set(f.findingIndex, f);
  }

  for (const agent of brief.agents ?? []) {
    // Rule 11. Not a person, so not a pattern, and no warning either.
    if (isIgnoredAgent(agent.agentName)) { out.ignoredAgents++; continue; }

    for (const opp of agent.opportunityPoints ?? []) {
      // Without a pattern key there is no stable identity to group on, and
      // inventing one from the explanation is exactly what this replaced.
      if (!opp.patternKey) continue;

      const existing = await database.select(
        'coach_patterns',
        `team_id=eq.${team.id}&agent_name=eq.${encodeURIComponent(agent.agentName)}`
        + `&pattern_key=eq.${encodeURIComponent(opp.patternKey)}&select=id`,
      );

      const now = new Date().toISOString();
      let patternId: string;
      if (existing.length) {
        patternId = (existing[0] as any).id;
        // The newest wording wins for display. It does not change identity.
        await database.update('coach_patterns', `id=eq.${patternId}`, {
          explanation: opp.explanation,
          coaching_move: opp.coachingMove ?? null,
          last_seen_at: now,
          updated_at: now,
        });
      } else {
        const row = await database.insert('coach_patterns', {
          org_id: team.org_id,
          team_id: team.id,
          agent_name: agent.agentName,
          agent_id: agentLinks[agent.agentName] ?? null,
          pattern_key: opp.patternKey,
          explanation: opp.explanation,
          coaching_move: opp.coachingMove ?? null,
        });
        patternId = (row as any).id;
        out.patterns++;
      }

      // Resolve the evidence. findingIds is the durable path; findingIndex is
      // the fallback for a payload that carries only the old shape.
      const findings: any[] = [];
      for (const id of opp.findingIds ?? []) {
        const f = byId.get(id);
        if (f) findings.push(f);
      }
      if (!findings.length && opp.findingIndex !== undefined) {
        const f = byIndex.get(opp.findingIndex);
        if (f) findings.push(f);
      }

      for (const f of findings) {
        const findingId = f.findingId;
        // No durable id means we cannot tell tomorrow whether this is the same
        // evidence. Counting it would inflate every recurrence threshold, so it
        // is dropped rather than guessed at.
        if (!findingId) continue;
        try {
          await database.insert('coach_pattern_findings', {
            pattern_id: patternId,
            finding_id: findingId,
            org_id: team.org_id,
            team_id: team.id,
            // When it HAPPENED, never when we heard about it.
            occurred_at: f.occurredAt ?? null,
            lead_name: f.leadName ?? null,
            lead_url: f.leadUrl ?? null,
            channel: f.channel ?? null,
            quote: f.quote ?? null,
          });
          out.newFindings++;
        } catch {
          // The primary key rejected it: we already have this exact evidence.
          // This is rule 3 working, and it is the common case on days two
          // through seven of any finding's life.
          out.duplicateFindings++;
        }
      }
    }
  }

  // Rule 6 — advance the window only now, and only for an accepted report.
  await database.upsert('coach_team_state', [{
    team_id: team.id,
    org_id: team.org_id,
    last_run_id: brief.run.runId,
    window_start: brief.run.startDate,
    window_end: brief.run.endDate,
    generated_at: brief.run.generatedAt ?? null,
    accepted_at: new Date().toISOString(),
  }], 'team_id');
  out.windowAdvanced = true;

  return out;
}

/**
 * What the Coach view and the trend area should show for a team.
 *
 * The split is rules 4, 5 and 10: `current` is what has evidence inside the
 * newest accepted window; `trend` is a pattern still inside ninety days whose
 * evidence has all aged out, shown with the label rule 10 specifies. Nothing
 * old is ever presented as new.
 */
export async function coachViewFor(database: Db, teamId: string) {
  const rows = (await database.select(
    'coach_patterns_live',
    `team_id=eq.${teamId}&select=*&order=occurrences.desc`,
  )) as any[];

  const current = rows.filter((r) => r.is_current);
  const trend = rows.filter((r) => !r.is_current && r.is_recurring);
  const state = rows[0];

  return {
    lastUpdate: state?.last_update ?? null,
    window: state ? { start: state.window_start, end: state.window_end } : null,
    current: current.map((r) => ({
      agent: r.agent_name,
      patternKey: r.pattern_key,
      explanation: r.explanation,
      coachingMove: r.coaching_move,
      occurrences: Number(r.occurrences),
      thisWindow: Number(r.occurrences_this_window),
      recurring: !!r.is_recurring,
    })),
    trend: trend.map((r) => ({
      agent: r.agent_name,
      patternKey: r.pattern_key,
      explanation: r.explanation,
      occurrences: Number(r.occurrences),
      latestEvidence: r.latest_evidence,
      note: 'No new example this week',
    })),
  };
}

/**
 * Did last night's run actually work?
 *
 * Nobody is watching at 5am Pacific, and the failure modes here are quiet ones:
 * a report that arrived but held because a slug drifted, a payload that parsed
 * but carried no pattern keys, evidence that all deduplicated because Hermes
 * re-sent an identical window. None of those throw. Each just leaves the Coach
 * view emptier than it should be, which looks like a quiet week rather than a
 * broken pipeline.
 *
 * So this reports what a person would actually check, per team, in the order
 * they would check it.
 */
export async function coachPipelineHealth(database: Db) {
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const [teams, reports, state, patterns] = await Promise.all([
    database.select('teams', 'is_active=eq.true&select=id,name,report_slug'),
    database.select('coach_weekly_reports',
      `received_at=gte.${since}&select=team_id,team_slug,run_id,run_trigger,status,`
      + `week_start,week_end,generated_at,received_at,payload&order=received_at.desc`),
    database.select('coach_team_state', 'select=*'),
    database.select('coach_patterns_live', 'select=team_id,is_current,is_recurring'),
  ]);

  const stateByTeam = new Map((state as any[]).map((s) => [s.team_id, s]));

  // Reports that arrived carrying a slug no team claims. These are sitting held
  // where nobody will ever see them, and it is exactly how Scott Moore and
  // Woosley were silently dropping reports until their slugs were set.
  const claimed = new Set((teams as any[]).map((t) => t.report_slug).filter(Boolean));
  const orphanSlugs = new Set(
    (reports as any[]).filter((r) => !r.team_id && !claimed.has(r.team_slug))
      .map((r) => r.team_slug),
  );

  const reportsByTeam = new Map<string, any[]>();
  for (const r of reports as any[]) {
    const k = r.team_id ?? `slug:${r.team_slug}`;
    reportsByTeam.set(k, [...(reportsByTeam.get(k) ?? []), r]);
  }

  const out = (teams as any[]).map((t) => {
    const mine = reportsByTeam.get(t.id) ?? [];
    const newest = mine[0] ?? null;
    const s = stateByTeam.get(t.id) ?? null;
    const live = (patterns as any[]).filter((p) => p.team_id === t.id);

    const problems: string[] = [];
    // Things worth saying that are not faults. Keeping them apart matters: a
    // check that cries wolf about expected states is one nobody reads.
    const notes: string[] = [];
    if (!t.report_slug) {
      // No slug and nothing arriving means the team simply is not on Hermes
      // yet. That is a decision somebody made, not a fault, and reporting it as
      // one every morning trains a person to stop reading this.
      //
      // A missing slug WHILE reports arrive under some other name is a
      // different thing entirely, and that one is real.
      if (orphanSlugs.size) {
        problems.push(
          `reports are arriving under unclaimed slugs (${[...orphanSlugs].join(', ')})`
          + ' and no team maps them',
        );
      } else {
        notes.push('not connected to Hermes yet');
      }
    } else if (!mine.length) {
      problems.push('no report received in the last 36 hours');
    } else {
      const v = newest.payload?.schemaVersion ?? '1.0';
      const held = newest.status !== 'published';
      const handRun = newest.run_trigger !== 'daily' && newest.run_trigger !== 'weekly';

      // A hand-run report being held is the system working, not failing - it is
      // the whole point of rule 1. Only a SCHEDULED report that failed to
      // publish is a problem.
      if (held && !handRun) {
        problems.push(`newest scheduled report is ${newest.status}, not published`);
      } else if (held && handRun) {
        notes.push(`newest is a ${newest.run_trigger} run, correctly held`);
      }

      if (v !== '1.1') {
        notes.push(`newest is schema ${v}, so it carries no pattern keys - expected until the first daily run`);
      }

      // The quietest failure of the lot: it parsed, it published, and the Coach
      // view stayed empty anyway.
      if (v === '1.1' && !held && !s) {
        problems.push('report published but nothing was absorbed');
      }
      if (s && !held && newest.run_id !== s.last_run_id) {
        problems.push('the window did not advance to the newest report');
      }
    }

    return {
      team: t.name,
      slug: t.report_slug,
      lastReport: newest ? {
        runId: newest.run_id,
        trigger: newest.run_trigger,
        status: newest.status,
        schema: newest.payload?.schemaVersion ?? '1.0',
        window: `${newest.week_start} to ${newest.week_end}`,
        receivedAt: newest.received_at,
      } : null,
      absorbedWindow: s ? `${s.window_start} to ${s.window_end}` : null,
      lastUpdate: s?.generated_at ?? null,
      patterns: {
        total: live.length,
        showingNow: live.filter((p) => p.is_current).length,
        recurring: live.filter((p) => p.is_recurring).length,
        inTrendOnly: live.filter((p) => !p.is_current && p.is_recurring).length,
      },
      ok: problems.length === 0,
      problems,
      notes,
    };
  });

  // Green on its own is ambiguous, and that is a trap worth closing.
  //
  // Before the first daily run every team reads OK - correctly, because nothing
  // is broken - and after a successful run every team also reads OK. Somebody
  // glancing at a green screen cannot tell "it worked" from "it has not
  // happened yet", which is the single question they opened this to answer.
  //
  // So say it outright, based on whether a daily 1.1 report has actually
  // landed, rather than leaving it to be inferred from a schema number.
  const daily = (reports as any[]).filter(
    (r) => r.run_trigger === 'daily' && (r.payload?.schemaVersion ?? '1.0') === '1.1',
  );
  const teamsWithDaily = new Set(daily.map((r) => r.team_id).filter(Boolean));
  const connected = out.filter((t) => !t.notes.includes('not connected to Hermes yet'));

  let verdict: string;
  if (!daily.length) {
    verdict = 'No daily report has arrived yet. Nothing is broken; it has not run.';
  } else if (teamsWithDaily.size < connected.length) {
    const missing = connected
      .filter((t) => !daily.some((r: any) => r.lastSeenTeam === t.team))
      .length;
    verdict = `A daily run landed for ${teamsWithDaily.size} of ${connected.length} connected teams.`
      + (missing ? ' The rest did not receive one.' : '');
  } else {
    verdict = `A daily run landed for all ${connected.length} connected teams.`;
  }

  return {
    checkedAt: new Date().toISOString(),
    // Has the thing you are checking for actually happened?
    ranToday: daily.length > 0,
    verdict,
    healthy: out.every((t) => t.ok),
    teams: out,
  };
}
