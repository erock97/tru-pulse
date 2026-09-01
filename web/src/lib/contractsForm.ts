/**
 * The pure logic behind the Contracts draft wizard — everything that can be
 * decided without a network or a DOM lives here so it can be tested flat.
 *
 * Ported from TRU OS's Contracts sector (Jarvis-OS src/cockpit/sectors/
 * Contracts.jsx), where each of these rules was earned:
 *
 *   - The plan carries its own price. Picking a plan fills the retainer;
 *     typing the retainer again is just a chance to get it wrong.
 *   - Blanks the form already knows from something else on the screen are
 *     derived, never asked for twice — "who is signing" used to end up typed
 *     three times.
 *   - A second signer's blanks only count as required once a second signer
 *     was actually added; otherwise an optional role blocks every submit.
 */

// ── Product knowledge ───────────────────────────────────────────────────────
// The Terrason plan sheet. Picking a plan is the only decision here — the
// retainer follows from it. Prices track assets/Terrason_Consulting_Pricing.html
// in TRU OS; if the sheet changes, this table changes with it.
export const PLANS: Array<{ name: string; retainer: string }> = [
  { name: 'Essentials', retainer: '$3,750' },
  { name: 'Performance', retainer: '$5,250' },
  { name: 'Performance+', retainer: '$6,750' },
  { name: 'Embedded', retainer: '' }, // custom — priced per engagement
];

export const PER_DEAL_FEES = ['$250', '$500', '$750'];

/** The retainer a plan carries, or null for a plan we don't know (free-typed). */
export function retainerForPlan(planName: string): string | null {
  const plan = PLANS.find((p) => p.name === planName);
  return plan ? plan.retainer : null;
}

// ── Humanizing the blanks ───────────────────────────────────────────────────
// Blank names come back as they are stored ("monthly_retainer"); nobody should
// have to read snake_case to fill in a contract.
export function humanizeKey(key: string): string {
  return String(key).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Plain words for the blanks that are left. The stored key is what the
 *  document calls them; this is what a person calls them. */
export const BLANK_LABELS: Record<string, string> = {
  effective_date: 'Start date',
  client_state: 'Their state',
  client_type: 'Their entity type',
  deal_threshold: 'Free deals each month before the per-deal fee starts (blank = paid from deal one)',
  monthly_retainer: 'Monthly retainer',
  client_signer_title: 'Their title, e.g. Broker of Record',
  lead_sources: 'Lead sources they receive',
  current_emphasis: "What you're emphasising right now",
};

/** Blanks that are the same on almost every contract. They are defaults, not
 *  decisions: every one of them is an ordinary editable box once it lands. */
export function defaultValue(key: string, today: Date = new Date()): string {
  if (key === 'effective_date') {
    return today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  if (key === 'client_state') return 'New Jersey';
  if (key === 'client_type') return 'limited liability company';
  return '';
}

// ── Form state and derived blanks ───────────────────────────────────────────
export interface WizardPerson { name?: string; email?: string }

/** What the derived-blank rules read off the template form. */
export interface DerivableForm {
  client: string;
  people: Record<string, WizardPerson>;
}

/** Blanks the form already knows from something else on the screen. Asking for
 *  them again is how "who is signing" ends up typed three times.
 *    client_name        — the client box at the top
 *    client_signer_name — whoever was named as the client's signer
 */
export const DERIVED_BLANKS: Record<string, (form: DerivableForm) => string> = {
  client_name: (form) => form.client,
  client_signer_name: (form) => form.people?.client?.name || '',
  team_name: (form) => form.client,
  agent_name: (form) => form.people?.agent?.name || '',
  client_signer_2_name: (form) => form.people?.client_2?.name || '',
};

/** Fill the derived blanks from form state, without clobbering a value the
 *  person typed when the derivation comes back empty. Returns a new object. */
export function applyDerivedBlanks(
  values: Record<string, string>,
  form: DerivableForm,
): Record<string, string> {
  const out = { ...values };
  for (const [key, derive] of Object.entries(DERIVED_BLANKS)) {
    const derived = String(derive(form) || '').trim();
    if (derived) out[key] = derived;
  }
  return out;
}

// ── Roles and recipients ────────────────────────────────────────────────────
/** The slice of a template role this module reads. Structurally compatible
 *  with the api layer's ContractTemplateRole — kept separate so the tests
 *  never have to import the api module. */
export interface RoleShape {
  roleKey: string;
  optional: boolean;
  label: string;
  role: string;
  routingOrder: number;
  fixedName: string | null;
  fixedEmail: string | null;
}

/** A role carrying a fixed name and email is our own side (Eric, Adam) and is
 *  never asked for; only the other party is. */
export function roleIsFixed(role: RoleShape): boolean {
  return !!(role.fixedName && role.fixedEmail);
}

export type RecipientAssembly =
  | { ok: true; recipients: Array<{ name: string; email: string; role: string }> }
  | { ok: false; error: string };

/**
 * Turn the template's open roles plus what was typed into the recipient list
 * the worker expects. Optional roles only participate once they were added
 * ("+ add a second signer"); fixed roles are the server's job, not ours.
 */
export function assembleRecipients(
  roles: RoleShape[],
  people: Record<string, WizardPerson>,
  extraSigners: string[],
): RecipientAssembly {
  const open = roles
    .filter((role) => !roleIsFixed(role))
    .filter((role) => !role.optional || extraSigners.includes(role.roleKey));
  const recipients: Array<{ name: string; email: string; role: string }> = [];
  for (const role of open) {
    const person = people[role.roleKey] || {};
    if (!person.name?.trim() || !person.email?.trim()) {
      return { ok: false, error: `${role.label} needs a name and an email.` };
    }
    recipients.push({ name: person.name.trim(), email: person.email.trim(), role: role.role || 'signer' });
  }
  return { ok: true, recipients };
}

// ── Required-placeholder validation ─────────────────────────────────────────
export interface PlaceholderShape { key: string; required: boolean }

/**
 * Which required blanks are still empty, after the derived ones are applied.
 * The client_signer_2* family is skipped when no second signer was added —
 * those blanks belong to a signature block that will stay empty on purpose.
 */
export function missingRequiredPlaceholders(
  placeholders: PlaceholderShape[],
  values: Record<string, string>,
  hasSecondSigner: boolean,
): PlaceholderShape[] {
  return placeholders
    .filter((p) => p.required && !(values[p.key] || '').trim())
    .filter((p) => !p.key.startsWith('client_signer_2') || hasSecondSigner);
}

// ── The manual tab's line formats ───────────────────────────────────────────
/** "Fee: $5,000" lines → { Fee: "$5,000" }. A line with no colon, or nothing
 *  after it, simply isn't a field. */
export function parseFieldLines(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.split(/:(.*)/s).slice(0, 2).map((part) => part.trim()))
      .filter(([key, value]) => key && value),
  );
}

/** "Name | email | role" lines → recipient rows; the role defaults to signer
 *  and is lowercased because the worker matches it exactly. */
export function parseRecipientLines(text: string): Array<{ name: string; email: string; role: string }> {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const [name = '', email = '', role = 'signer'] = line.split('|').map((part) => part.trim());
      return { name, email, role: role.toLowerCase() || 'signer' };
    });
}

// ── The client book ─────────────────────────────────────────────────────────
// Everything typed for a client is kept, so the second contract for the same
// brokerage is a pick from a list rather than ten boxes again. Local to this
// browser on purpose: it holds client contact details and nothing about it is
// worth a round trip. SAME key as TRU OS used, so anything remembered there
// (the app ran in the same browser) is not lost.
export const CLIENT_BOOK_KEY = 'tru.contracts.clientbook.v1';

export interface ClientBookEntry {
  client: string;
  team?: string;
  values?: Record<string, string>;
  people?: Record<string, WizardPerson>;
  savedAt?: string;
}

export type ClientBook = Record<string, ClientBookEntry>;

/** The storage this book needs — window.localStorage, or a plain stub in tests. */
export interface BookStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): BookStorage | null {
  // Guarded because the tests run under node, where window does not exist.
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
}

export function readClientBook(storage: BookStorage | null = defaultStorage()): ClientBook {
  try {
    const raw = storage?.getItem(CLIENT_BOOK_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as ClientBook) : {};
  } catch {
    return {};
  }
}

export function rememberClient(entry: ClientBookEntry, storage: BookStorage | null = defaultStorage()): void {
  const key = String(entry.client || '').trim().toLowerCase();
  if (!key || !storage) return;
  try {
    const book = readClientBook(storage);
    book[key] = { ...entry, savedAt: new Date().toISOString() };
    storage.setItem(CLIENT_BOOK_KEY, JSON.stringify(book));
  } catch {
    /* a full or blocked localStorage costs the shortcut, not the contract */
  }
}

/** Typing or choosing a client that has been used before brings back
 *  everything that was filled in for them last time. */
export function recallClient(book: ClientBook, client: string): ClientBookEntry | null {
  return book[String(client).trim().toLowerCase()] ?? null;
}
