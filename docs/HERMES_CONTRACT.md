# The Hermes Analysis Contract — full rules for a fresh run

**For Codex.** This consolidates and supersedes every note sent on 2026-08-25
(call evidence, cite-the-line, lead_e). It exists because Eric spent the day
defining TRU's actual coaching logic — written down in `docs/SALES_DOCTRINE.md`
in this repo — and every report currently in the store was produced *before*
that logic existed. Patching the display cannot fix reasoning that happened
upstream. The ask: implement these rules in Hermes, then run a **fresh full
analysis** for all four teams. TRU HQ will reset its derived pattern store the
day the fresh run lands, so the new reasoning repopulates cleanly instead of
mixing with the old.

Read `docs/SALES_DOCTRINE.md` first. It is Eric's own logic, in his words.
These are the analysis-side consequences.

---

## 1. What a coaching point IS

Written **for Eric and the team leader**, never for the agent. The bar, in
Eric's words: *"I never would have caught that. I clearly understand what the
problem is. I can go to my agent and have a productive conversation. I have
the proof of where the thing occurred."*

- **Every point carries its WHY.** These agents are not trained salespeople.
  "Call first before texting" without the reason gets ignored, reasonably.
- **Personable, not shorthand.** Not meeting-notes fragments ("Two specific
  meeting times"), not vague abstractions. Full sentences a person would say.
- **A rate beats a count** where the data supports one: "about one phone call
  attempt on average; the bulk of his communication is through text."

## 2. Every claim cites its source — the hard rule

**A coaching point that cannot cite its source must not exist.**

- Where an AI call summary exists, a transcript exists on the same page.
  **Read the transcript, not only the summary.** Quote the specific line the
  claim came from in a `sourceQuote` field on the opportunity (plus
  `sourceChannel`, ideally a timestamp/offset).
- The summary is proof of *what happened* (Eric: "that AI summary is just as
  good as a transcript — that is proven"). What it cannot prove is exact
  wording or *where in the call* something was said. Claims about wording need
  the transcript line.
- **Negative claims are the dangerous ones.** "She never offered a time" is a
  statement about an entire call. It is only safe from a full transcript —
  never from a summary that simply didn't mention it.
- The live failure this prevents: Joseph Darlington's card said he "told
  Bishoy Yacoub a completely blank seller disclosure was not a red flag" —
  the record holds only "working on an offer for a condo; the seller's
  disclosure is completely blank." The reassurance was invented and Eric was
  dialling the agent about it. One of these ends the product's credibility.

## 3. Taxonomy semantics — the `lead_*` keys are the LEAD steps

L = lead with who you are · E = extend the invitation (appointment asked for
EARLY, this-or-that) · A = ask and listen, permission first · D = deliver the
summary, confirm what's next.

- **`lead_e` may only be tagged when the finding is the FIRST live interaction
  with that lead.** It is a first-call technique. Tagged onto a
  mid-relationship follow-up it reads as nonsense to a broker — this happened
  live on Cara Benak's brief ("you're misapplying my logic... a moot point").
  A later conversation ending without a specific time attempt is `next_steps`,
  or a new key of your choosing for "no specific time proposed, ongoing
  relationship." The behaviour is coachable; the first-call framing is what
  invalidates it.
- The appointment-early rule is a **strong default, not absolute**: flag, do
  not fail, an agent who read the moment.

## 4. What does NOT count as evidence or coaching material

- **A voicemail is an attempt, never a conversation.** It counts toward
  persistence (five unique attempts in the first seven days from lead
  arrival; calls and agent-written texts count, FUB automated texts and email
  do not). It cannot support coaching about conversation technique — Erica
  Stevens's entire profile was two points built on one six-word voicemail
  note. Do not emit conversation-technique claims from voicemail-only
  evidence.
- **Very short calls** (under ~30s) support "call quality / never reached a
  conversation" and nothing about technique. Send `durationSeconds` if it is
  on the page.
- **Notes written by our own system are not evidence of agent behaviour** —
  they prove someone flagged something, nothing more.
- **Coach-facing observations** ("review the recordings") are not agent
  coaching points. Do not emit them as opportunities.
- **Do not coach the people running the team.** Brokers, team leads, office
  staff are analysed but their points must not surface as agent coaching (TRU
  HQ also filters this; do both).

## 5. Consistency — the rule that spans the whole run

Eric's recurring experience: one agent's brief applies the logic correctly and
ten others don't. Each explanation appears to be generated per-finding in
isolation. **Whatever enforces these rules must run across ALL agents'
opportunities in a run, as a final pass** — same category, same reasoning,
same standard of evidence, every agent. A rule applied to one agent and not
their neighbour is worse than the rule not existing, because it teaches the
reader the output is arbitrary.

## 6. Mechanical/schema items

- `findingId` (durable hash) and `patternKey` — keep exactly as they are;
  the 90-day store keys on them.
- Add per opportunity: `sourceQuote` (the transcript line), `sourceChannel`,
  optionally `sourceQuality: "transcript" | "summary"`, optionally
  `durationSeconds` on call findings.
- **Trim FUB chrome from quotes**: thread headers ("Joseph Darlington Bishoy
  Yacoub (1 min 19 sec) Aug 20 Summary Transcript"), "Suggested Tasks",
  "Did you find the summary useful?".
- Texts are in good shape — 191 of 192 verbatim. Don't change that path.
- Schema stays 1.1-compatible; additions are optional fields so old parsing
  keeps working.

## 7. The fresh run, and what TRU HQ does when it lands

1. Codex implements the above and confirms.
2. Hermes runs a fresh full analysis (all four connected teams, normal 7-day
   window, new runIds).
3. **Tell TRU HQ it is a fresh-logic run** — simplest: bump `schemaVersion`
   to `1.2`, or say so and we key on the runId.
4. TRU HQ resets the derived pattern store (`coach_patterns`,
   `coach_pattern_findings`, `coach_team_state`, and the brief-memory
   columns) immediately before ingesting it, so the new reasoning populates
   clean. The raw reports table is never touched — history stays.

Nothing here blocks the current daily runs; keep them going until the new
logic ships.
