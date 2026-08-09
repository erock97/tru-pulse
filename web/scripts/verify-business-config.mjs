// Refuses to build a half-renamed site.
//
// While PENDING_ENTITY_CHANGE is true, the outgoing entity name is expected and
// allowed. Once it is set to false — meaning "the new entity is registered and
// filled in" — any surviving mention of the old one is a bug that would put the
// wrong contracting party on the privacy policy, so the build fails loudly.
import { readFileSync } from 'node:fs';

const path = new URL('../src/config/business.ts', import.meta.url);
const src = readFileSync(path, 'utf8');

const pending = /PENDING_ENTITY_CHANGE\s*=\s*true/.test(src);
const stale = [...src.matchAll(/^.*terrason.*$/gim)].map((m) => m[0].trim());

if (!pending && stale.length) {
  console.error('\n  Business config still names the outgoing entity, but');
  console.error('  PENDING_ENTITY_CHANGE is false. Fix these lines:\n');
  for (const line of stale) console.error(`    ${line}`);
  console.error('\n  Then rebuild.\n');
  process.exit(1);
}

if (pending) {
  console.warn('  business.ts: legal entity change still pending — shipping the outgoing name.');
}
