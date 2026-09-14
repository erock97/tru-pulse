import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle, selectProjects, mapping, organizationId } from './sync-bitwarden-secrets.mjs';

const projects = mapping.map((m, i) => ({ id: String(i), name: m.project, organizationId }));
const selected = selectProjects(projects);
const secrets = selected.map(s => ({ ...s, organizationId, value: `fake-${s.key}` }));
test('matches organization, project and key, ignoring similarly named unrelated secrets', () => {
  const output = JSON.parse(buildBundle(selected, [...secrets, { ...secrets[0], projectId: 'another', value: 'wrong' }]));
  assert.equal(output.STRIPE_SECRET_KEY, 'fake-STRIPE_SECRET_KEY');
  assert.equal(Object.keys(output).length, 2);
});
test('rejects duplicate or absent projects and secrets before delivery', () => {
  assert.throws(() => selectProjects([...projects, projects[0]]));
  assert.throws(() => selectProjects(projects.map(p => ({ ...p, organizationId: 'wrong' }))));
  assert.throws(() => buildBundle(selected, secrets.slice(1)));
  assert.throws(() => buildBundle(selected, [...secrets, secrets[0]]));
});
test('rejects unresolved references and empty values without printing the value', () => {
  for (const value of ['', ' ', '${prod.Stripe.KEY}']) {
    assert.throws(() => buildBundle(selected, [{ ...secrets[0], value }, secrets[1]]), /Empty or unresolved secret: STRIPE_SECRET_KEY/);
  }
});
