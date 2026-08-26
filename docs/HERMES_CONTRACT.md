# The Hermes Analysis Contract v2 — field-level spec for a fresh run

**For Codex**, who builds the harness that scopes the local model (Qwen) and
the analyst (Grok) inside Hermes. Supersedes v1 and every note sent 2026-08-25.

**Why v2 exists:** v1 was written as principles, and principles are for big
brains. The collection is done by a local model, and Eric's operational
experience is blunt: *scope it very specifically or it flat out overlooks.*
So this version is a checklist and an exact payload shape. Every field below
lands in a specific slot in the TRU HQ display, listed so you can see that
**the more complete the payload, the less TRU HQ has to invent — and TRU HQ
inventing things is what every failure today had in common.**

The reasoning behind these rules is `docs/SALES_DOCTRINE.md` (Eric's own
coaching logic, in his words). This file is the mechanical consequence.

---

## 1. The collection checklist — what the local model captures per conversation

One record per conversation, no exceptions, no summarising at collection time.
Collection gathers; the analyst judges. For EVERY conversation:

```
[ ] channel            call | text | note | voicemail
[ ] occurredAt         ISO timestamp of the interaction itself
[ ] leadName           the contact's name as FUB shows it
[ ] leadUrl            the FUB contact URL (deep link)
[ ] agentName          exactly as FUB attributes it
[ ] direction          outbound | inbound
[ ] durationSeconds    calls only, from the page
[ ] transcriptText     calls: the FULL transcript block, not the AI summary
[ ] summaryText        calls: the AI summary too (both exist on the page)
[ ] bodyText           texts: the verbatim message body
[ ] isFirstContact     true | false | unknown — is this the EARLIEST
                       interaction with this lead in the record? Determined
                       by comparing against the lead's full timeline, never
                       guessed from the content of the message.
```

Strip FUB interface chrome at collection: thread headers
("Joseph Darlington Bishoy Yacoub (1 min 19 sec) Aug 20 Summary Transcript"),
"Suggested Tasks", "Did you find the summary useful?".

`isFirstContact` is the field the whole taxonomy leans on (§3). If the
timeline cannot be established, send `unknown` — never guess.

## 2. The opportunity object — exact shape, every field named

```json
{
  "patternKey": "lead_e",
  "isFirstContact": true,
  "explanation": "Her text to Nick McQuinn asked permission to send listings instead of giving him a chance to pick a specific time to meet.",
  "coachingMove": "Offer two specific times and ask Nick to choose one.",
  "sourceQuote": "Want me to put together some listings for you this week?",
  "sourceChannel": "text",
  "sourceQuality": "verbatim",
  "findingIds": ["fnd_..."],
  "durationSeconds": null
}
```

Field rules, one per line, in the local model's terms:

- `patternKey` — from the fixed list in §3 ONLY. Never invent a key.
- `explanation` — the STORY, at the §5 gold-standard register: what the buyer
  wanted, what the agent did, what it cost, and the rate when there is one.
  Three to five sentences when the story needs them — the evidence rules below
  are a floor on proof, never a target for brevity. The first 1.2 batch read
  "incredibly shallow" (Eric, 2026-08-26) because a sentence cap was taken as
  the goal. MUST name the lead. MUST describe what happened in that specific
  conversation. MUST NOT assert anything the sourceQuote does not show.
- `coachingMove` — one sentence, imperative, the concrete alternative.
- `sourceQuote` — **the exact line from the transcript or text body that the
  claim is based on. If no line supports the claim, DO NOT EMIT THE
  OPPORTUNITY.** This is the single most important rule in this document.
- `sourceQuality` — `"verbatim"` when the quote is speech or a message body;
  `"summary"` when only the AI summary supports it. A `"summary"` source can
  never carry a claim about exact wording or about something NOT said.
- Negative claims ("she never offered a time") are claims about an ENTIRE
  conversation: allowed only with `sourceQuality: "verbatim"` covering the
  full close of the conversation.

## 3. The pattern keys — definitions the collector can apply

`lead_*` are the four steps of LEAD, TRU's first-call framework.

| key | tag when | NEVER tag when |
|---|---|---|
| `lead_l` | first contact, agent did not open with name/brokerage/Zillow/why calling | not first contact |
| `lead_e` | **first contact only** (`isFirstContact: true`), no appointment invitation offered early with a this-or-that choice | `isFirstContact` is false or unknown |
| `lead_a` | agent skipped permission + real discovery questions | — |
| `lead_d` | conversation ended without restating plan + confirming next step | — |
| `next_steps` | ANY later conversation that ended without a specific time attempt | it was first contact (that is `lead_e`) |
| `call_first` | texted where a call was needed (buyer asked to talk, or a §4-listed subject) | — |
| `call_quality` | call under ~30s, no conversation reached | to make claims about technique |
| `objection` | agent retreated when the buyer pushed back | — |
| `text_transition` | property details sent before any live conversation | — |
| `negative_property_pivot` | bad news delivered and left sitting, no pivot to what's possible | — |
| `premature_financing` | money raised before trust/first meeting | — |
| `premature_representation` | promised what can only be asked for; or "are you working with an agent" as a barrier | — |
| `tone_rushed` | call where the agent hurries to end it, flat checked-out delivery | from a summary — needs the transcript |
| `tone_curt` | curt, cold texting — one-word replies, abrupt messages | a merely short text that answered the question warmly |

The misapplication this table exists to stop, live on Cara Benak's brief:
`lead_e` tagged on conversations never shown to be first contact. Eric:
*"you're misapplying my logic... a moot point."*

### 3a. Pick the DOMINANT failure — the channel outranks the close

One conversation gets ONE opportunity, tagged with the biggest miss, not the
easiest one to detect. Ranking rule, applied before choosing any key:

1. **Channel first.** Significant news delivered by text (a home going under
   contract, bad news of any kind, the buyer asking to talk), or a lead the
   agent has NEVER called → `call_first`. Bad news left sitting →
   `negative_property_pivot`. Stop there; do not also tag the missing time.
2. **`next_steps` only when the channel was right** and the sole miss was
   ending without a specific time attempt.

Live failure this exists to stop (2026-08-26): 58 of 92 opportunities tagged
`next_steps`, `call_first` tagged twice across four teams — on rosters whose
own metrics show texting dominating. "Ended without a time" fires on every
conversation that ends; without this ranking it buries every bigger concern.
Eric: *"'They should have offered specific times to connect' — that is the
smallest concern here."*

### 3b. The reasoning walk-through — run this per agent BEFORE tagging

From Eric's interview, 2026-08-26 (docs/SALES_DOCTRINE.md, same-named
section). The analyst reasons through these in order for every agent:

1. **Channel habits.** Call or text first, per new lead, and the rate. A
   Zillow message counts as a text.
2. **Sensitive subjects on the wrong channel → `call_first`.** The must-call
   list, all four confirmed by Eric:
   - property no longer available (under contract / sold / off market /
     seller rejected)
   - any disappointing update (price, inspection, financing, appraisal)
   - hyper-specific property discussion that has outgrown texting
   - money and finances, ALWAYS
3. **Tonality — exactly two flags, no more.** `tone_rushed` (calls: hurrying
   to end, flat checked-out delivery; quote the transcript, durationSeconds
   in support) and `tone_curt` (texts: one-word, abrupt, cold; quote the
   text). Eric explicitly did NOT select scripted-sounding delivery or
   talking-over-the-buyer — do not flag those.
4. **Down-funnel leads weigh heavier.** A lead at met-with stage or further:
   a miss with them outranks the same miss on a cold lead, both in what gets
   tagged and in what leads the agent's brief.
5. Only then, technique: the time ask and the rest of the taxonomy.

To make step 4 possible, collection (§1) also captures per conversation when
the page shows it:

```
[ ] leadStage          the FUB stage as shown, verbatim; omit if not visible
```

## 4. Exclusions — evidence that cannot carry coaching

- **Voicemail-only evidence**: never a technique claim. A voicemail is an
  attempt (it counts toward the 5-in-7-days persistence floor), not a
  conversation. Live failure: an agent's entire profile built on one six-word
  voicemail note.
- **Short calls** (<~30s): `call_quality` only.
- **Notes written by our own system**: proof someone flagged something, not
  proof of agent behaviour.
- **Coach-facing observations** ("review the recordings"): not opportunities.
- **Brokers / team leads / office staff**: analysed, never coached in output.
- **FUB automated texts** (leadFlowRouteId set): not the agent's work.
- **Email**: not counted for anything.

## 5. The gold-standard output, verbatim from Eric

This is the register every explanation aims at — specific, personable, a rate
not just a count, and the why attached:

> "Aaron has frequently texted leads and is not making any attempted phone
> call. He frequently makes about one phone call attempt on average, and the
> bulk of his communication is done through text. Should probably sit down
> with Aaron this week and talk about why we are leading with text first and
> the value of why we want to call our leads."

And the anti-pattern, also his, verbatim: *"Coaching plan: Tell agent to call
first before texting"* — concise, useless, not insight.

## 6. The consistency pass — runs over the whole payload, last

Before sending, one final pass over EVERY agent's opportunities together:

```
[ ] every opportunity has a sourceQuote                → drop any that don't
[ ] every lead_e has isFirstContact: true              → retag or drop
[ ] no voicemail-only technique claims                 → drop
[ ] no coach-facing points                             → drop
[ ] no points on brokers/leads/staff                   → drop
[ ] same behaviour = same patternKey on every agent    → retag
[ ] every next_steps sits on a right-channel conversation (§3a) → retag
[ ] next_steps is not the majority of the whole batch  → re-run §3a on all
[ ] no FUB chrome inside any sourceQuote               → strip (§1)
[ ] every tone_* claim quotes verbatim words that show it (§3b) → drop
[ ] no single patternKey dominates the batch           → re-run §3b on all
```

The pass also REPORTS what it dropped: a count per check, in the run notes.
A quality bar that silently deletes insight looks identical to a team with
nothing to coach — and "the output got incredibly shallow" is what that
looks like from Eric's chair. Dropping is correct; dropping invisibly is not.

Eric's recurring experience is one agent's brief correct and ten others not,
because rules were applied per-finding in isolation. This pass is the cure,
and it must not be skippable.

## 7. Per-agent metrics — what the display's rates are built from

Keep sending, per agent: `callFirst`, `textFirst`, `noOutreach`,
`reviewedContacts`, `substantiveContacts`. These feed the per-card mix strip
and the "11 of 15 first touches were texts" rate lines. Add if cheap:
`attemptsThisWeek` per lead (calls + agent-written texts + voicemails, no
automated texts, no email) — that makes the five-attempt persistence floor
measurable upstream too.

## 8. Where each field lands in TRU HQ (so nothing gets invented downstream)

| payload field | display slot |
|---|---|
| `patternKey` | the serif italic label line on the card, via a fixed phrase table |
| `explanation` | the story — the card's body sentence |
| `coachingMove` | the "Coach:" line |
| `sourceQuote` + finding quotes | "Proof (n)", collapsed until clicked |
| finding `leadName`/`leadUrl` | the named, linked contacts in the proof and in "with Nick, Tiana, and Vincent" |
| metrics | the card's mix strip + rate sentences |
| `sourceQuality` | (coming) a "from the summary" tag when not verbatim |

## 9. The fresh run

1. Codex implements this and confirms.
2. Hermes runs a fresh full analysis, all four teams, normal window.
3. Mark it: `schemaVersion: "1.2"`.
4. TRU HQ runs `db/hq_coach_fresh_start.sql` immediately before ingest —
   derived pattern store cleared so new reasoning populates clean; the raw
   report history untouched.

Keep the current daily runs going until then.
