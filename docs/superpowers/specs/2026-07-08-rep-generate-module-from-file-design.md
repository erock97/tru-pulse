# Rep — Generate Module from a File (AI-assisted authoring)

**Date:** 2026-07-08
**Status:** Design approved, pending spec review → implementation plan
**Feature area:** TRU Pulse › Rep tab › custom module authoring
**Repo:** `Desktop/truhq/pulse` (packages `tru-pulse-web`, `tru-pulse-worker`)

## Problem

The custom-module authoring flow (shipped 2026-07-08) works but is laborious: a
leader hand-builds every lesson card and every quiz question, even when they
already own the training material in a file (a deck, a PDF playbook, a recording).
We want leaders to **upload material they already have and get a full draft module
back**, then review and publish.

## Goal

Add **"Generate from file"** to the Manage-modules panel. A leader uploads a
**PDF or PowerPoint**, Claude drafts a complete module (title, summary, lesson
cards, quiz with answers, pass %), the original file is attached as a downloadable
card, and the leader lands in the **existing `ModuleEditor`** to review/edit and
publish. Nothing goes live unreviewed.

## Non-goals (Phase 1)

- **Video → module** (needs speech-to-text; separate Phase 2 spec).
- **One-click auto-publish** — generated modules are always drafts a human approves.
- Editing/regenerating an already-published module from a new file (create-only).
- OCR of scanned image-only PDFs (best-effort; warn if extraction is thin).

## Decisions locked with Eric

| Decision | Choice |
|---|---|
| Inputs, Phase 1 | **PDF + PowerPoint together** |
| Automation level | **Generate a DRAFT → leader reviews in existing editor → publishes** |
| Source file fate | **Attach it** to the module as a downloadable media card |
| pptx extraction | Browser-side via **JSZip** (approved new frontend dep) |
| Generation model | **Sonnet 5 (`claude-sonnet-5`)**, behind a one-line config constant so it can be swapped/A-B'd |

## Architecture — one engine, two extractors

A single **"material → module draft"** engine (Claude does the structuring). Each
input type only differs in how content reaches Claude; both converge on one Worker
endpoint that persists a draft and returns its id.

```
Browser (Rep › Manage modules › "Generate from file")
  │  pick file
  ├── PDF  ──►  uploadRepMedia(file)  ──►  path in rep-media
  │                └─► POST /rep/modules/generate { kind:'pdf', org_id, path, filename }
  │                        Worker fetches the PDF (service role) → sends as a
  │                        Claude *document* block → forced tool-use → module JSON
  │
  └── PPTX ──►  uploadRepMedia(file)  ──►  path in rep-media   (for attachment)
                └─► extractPptxText(file)  (JSZip, in browser)
                     └─► POST /rep/modules/generate { kind:'text', org_id, text, path, filename }
                             Worker sends text → Claude → forced tool-use → module JSON

Worker /rep/modules/generate:
  1. Auth: verifySupabaseUser + isOrgLeaderOrAdmin(org_id)  (+ isUuid guards)  — same as other /rep authoring routes
  2. Call Claude (Sonnet 5) with a forced tool `emit_module` whose input_schema
     is our module shape → get validated JSON
  3. Server-side validate/normalize cards + questions against known types
  4. Append a { t:'media', kind, path, title } card for the uploaded file
  5. Persist as a DRAFT: insert rep_modules (source='custom', status='draft',
     active=false, author_id, org_id) + insert rep_questions   (reuse Block-2 logic)
  6. Return { moduleId }
Browser: open ModuleEditor on moduleId (loads via existing loadRepQuestionsForEdit)
```

### Why this shape
- **Reuses everything from the 2026-07-08 build:** `rep-media` bucket + upload
  path, the module/quiz schema, draft/publish lifecycle, `ModuleEditor`, the
  answer round-trip GET, and the org/leader auth guards. The only genuinely new
  pieces are the generate endpoint, the Claude call, and the pptx text extractor.
- **PDF uses Claude's native document reading** — no PDF parser in our code; Claude
  reads layout/tables/bullet structure directly, higher fidelity than text scraping.
- **pptx text extraction is browser-side** — Workers have no native unzip; the
  browser has JSZip and more slack, and the file is already in the user's hands.

## Components

### 1. Frontend — `web/src/pages/Rep.tsx` (+ helpers in `web/src/lib/api.ts`)
- **"✨ Generate from file"** button in `ModuleManager`, gated by the same
  `canAuthor` (`role === 'admin' || 'leader'`) signal as "New module."
- File picker accepting `.pdf` and `.pptx` (+ the pptx MIME types already in the
  bucket allow-list). Reject other types inline (no `alert()`).
- Progress UI: *"Reading your file… drafting the module…"* with a spinner and a
  cancel/close. On error, inline message (bad file, extraction empty, generation
  failed).
- On success → open the existing `ModuleEditor` on the returned `moduleId`.
- **`web/src/lib/pptx.ts`** (new): `extractPptxText(file): Promise<string>` —
  JSZip opens the `.pptx`, reads `ppt/slides/slide*.xml` in slide order, pulls
  `<a:t>` text runs, joins per-slide with headings (e.g. `## Slide 3`). Caps total
  characters (see Guardrails).
- **`api.ts`**: `generateModuleFromFile(input)` wrapper → `POST /rep/modules/generate`.

### 2. Worker — `worker/src/index.ts` + new `worker/src/generate.ts`
- Route `POST /rep/modules/generate` in the flat router, guarded exactly like the
  other `/rep` authoring routes (`verifySupabaseUser`, `isUuid(org_id)`,
  `isOrgLeaderOrAdmin`).
- `worker/src/generate.ts`:
  - `generateModule(env, { kind, text?, pdfBase64? }, sourceLabel)` — builds the
    Claude Messages request (mirroring `practice.ts`'s `fetch` to
    `api.anthropic.com/v1/messages`, `x-api-key: env.ANTHROPIC_API_KEY`), with:
    - `model = REP_GEN_MODEL` (const, default `'claude-sonnet-5'`).
    - a **forced tool** `emit_module` (`tool_choice: { type:'tool', name:'emit_module' }`)
      whose `input_schema` is the module JSON shape below — this is what makes the
      output reliably structured (no brittle brace-slicing like the grader).
    - PDF path: a `document` content block (base64 PDF). **Open item:** confirm the
      required `anthropic-version` / `anthropic-beta: pdfs-*` header for document
      blocks at build time; the grader uses `2023-06-01`.
  - `validateModule(json)` — enforce known card `t` types
    (`text|callout|script|steps|stat|stats|dialogue|compare|drill|video|media`) and
    question shape (`prompt`, `choices[≥2]`, `answer` in range, optional `explain`);
    drop/repair unknown cards; on total failure, one retry, then throw.
  - The route: generate → validate → append the media card for the uploaded file →
    persist draft (reuse the Block-2 module + questions insert logic; factor it into
    a small shared helper if cleanly possible) → return `{ moduleId }`.

### Generation contract — the `emit_module` tool schema
```jsonc
{
  "title": "string (≤80 chars)",
  "summary": "string (1–2 sentences)",
  "pass_pct": "integer 50–100 (default 80)",
  "cards": [
    // subset of existing LessonCard types; Claude picks the fitting ones:
    { "t": "text",    "title": "…", "body": "…" },
    { "t": "callout", "title": "…", "body": "…" },
    { "t": "script",  "title": "…", "body": "…" },
    { "t": "steps",   "title": "…", "steps": ["…","…"] }
    // (media card for the source file is appended server-side, not by Claude)
  ],
  "questions": [
    { "prompt": "…", "choices": ["…","…","…"], "answer": 0, "explain": "…" }
  ]
}
```
Defaults the prompt asks for: ~4–6 cards, 3–5 questions, `pass_pct` 80 — all fully
editable in `ModuleEditor` afterward. The exact card-type subset Claude is allowed
to emit is finalized during implementation against the real `LessonCard` union.

## Data flow / storage
- No schema change. Generated modules are ordinary `source='custom'`,
  `status='draft'` rows; the attached file is a normal `rep-media` object referenced
  by a `media` card — identical to a hand-authored module.
- The uploaded file is stored **once** (via `uploadRepMedia`) and used both as the
  generation source (PDF path: Worker fetches it) and the attached card.

## Error handling
- **Empty/failed extraction** (e.g. scanned pptx/PDF with no text) → inline:
  "Couldn't read enough text from that file — try a different file or build the
  module manually." No draft created.
- **Claude returns invalid JSON / tool misuse** → one retry, then a clean inline
  error; no partial draft persisted.
- **File too large / too many pages** → truncated with a visible notice (see caps).
- **Auth / cross-org** → same 401/403 shape as other `/rep` routes; `isUuid` guards
  on `org_id`/`path` before any interpolation.
- Never `alert()`/`confirm()`.

## Guardrails
- **Draft-only**, `active=false` — a human publishes. (Same invariant as Block 2:
  `active = (status === 'published')`.)
- **Input caps:** pptx extracted text capped (e.g. ~60k chars) and PDF page/size
  capped to keep within model context + control cost; over the cap → truncate +
  notify. Final numbers set in the plan.
- **Cost:** one Sonnet 5 call per generation (~cents); surfaced as a config, not
  per-use billing. Model behind `REP_GEN_MODEL` for easy swap/A-B.
- Reuses the `rep-media` `file_size_limit` (500 MB) + MIME allow-list already live.
- Answers exist only in the persisted draft + the authoring answer-GET; never on a
  learner path.

## Testing
- **Unit:** `validateModule` (good JSON, unknown card types dropped, out-of-range
  `answer` clamped/rejected, <2 choices rejected); `extractPptxText` against a small
  fixture `.pptx` (slide order, text runs, empty-deck → empty string).
- **Worker:** generate route rejects cross-org / non-leader / bad uuid; happy path
  returns a `moduleId` whose persisted draft is `status='draft'`, `active=false`.
- **Manual E2E:** upload a real deck and a real PDF as a leader → editor opens
  pre-filled → publish → an agent sees it, the attached file downloads, the quiz
  grades. Isolation: a leader in another org can't generate into this org.

## Phasing
- **Phase 1 (this spec):** PDF + PowerPoint → draft module + attached file, review &
  publish.
- **Phase 2 (later spec):** Video → transcription (new STT service, async) → same
  engine.

## Open items to settle during implementation
1. Exact `anthropic-version` / beta header for PDF **document** content blocks.
2. Final card-type subset Claude may emit (against the real `LessonCard` union).
3. Concrete input caps (pptx char cap, PDF page/size cap) and the truncation notice.
4. Whether to factor the Block-2 "insert module + questions" logic into a shared
   helper reused by both `/rep/modules` and `/rep/modules/generate`.
