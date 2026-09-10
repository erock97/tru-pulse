#!/usr/bin/env node
// No dependencies. Node 20+. Stores identifiers only, never credentials.
import { readFile, writeFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { createHash } from 'node:crypto';

export const confirmation = (agent, team, previous) => createHash('sha256')
  .update(JSON.stringify({ agent: normalize(agent), team, previous })).digest('hex');

export const API = 'https://api.truhq.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const normalize = value => String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const display = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

export function validateDirectory(body) {
  if (!Array.isArray(body?.teams)) throw Error('Invalid TRU HQ team directory.');
  const ids = new Set();
  return body.teams.map(t => {
    if (!UUID.test(t.teamId) || typeof t.name !== 'string' || !t.name.trim()
      || !Object.hasOwn(t, 'fubSubdomain') || !Object.hasOwn(t, 'organizationName')
      || !Array.isArray(t.leaderNames) || !t.leaderNames.every(n => typeof n === 'string')
      || (t.fubSubdomain !== null && (typeof t.fubSubdomain !== 'string' || !/^[a-z0-9-]+$/i.test(t.fubSubdomain)))
      || (t.organizationName !== null && typeof t.organizationName !== 'string')) {
      throw Error('Directory is missing valid linking details. Update the TRU HQ endpoint first.');
    }
    const teamId = t.teamId.toLowerCase();
    if (ids.has(teamId)) throw Error('Duplicate team ID in directory. No link was changed.');
    ids.add(teamId);
    return { teamId, name: t.name, organizationName: t.organizationName,
      fubSubdomain: t.fubSubdomain?.toLowerCase() ?? null, leaderNames: t.leaderNames,
      connected: t.connected === true };
  });
}

export function candidates(teams, query = '') {
  const words = normalize(query).split(' ').filter(Boolean);
  return teams.filter(t => {
    const haystack = normalize([t.name, t.organizationName, t.fubSubdomain, ...t.leaderNames].join(' '));
    return words.every(w => haystack.includes(w));
  });
}

export async function directory(token, request = fetch) {
  if (!token?.trim()) throw Error('Set TRUEHQ_COACH_TOKEN through your existing secret loader.');
  const response = await request(`${API}/coach/teams`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error(`TRU HQ directory request failed (HTTP ${response.status}).`);
  return validateDirectory(await response.json());
}

export async function readLinks(file) {
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { schemaVersion: 1, links: [] }; throw e; }
  const config = JSON.parse(raw);
  if (config.schemaVersion !== 1 || !Array.isArray(config.links)) throw Error('Invalid team links file.');
  const keys = new Set();
  for (const link of config.links) {
    if (typeof link.agent !== 'string' || !normalize(link.agent) || !UUID.test(link.teamId)
      || keys.has(normalize(link.agent))) throw Error('Invalid or ambiguous saved agent links.');
    keys.add(normalize(link.agent));
  }
  return config;
}

export function resolveLink(config, agent, teams) {
  const link = config.links.find(l => normalize(l.agent) === normalize(agent));
  if (!link) throw Error('This Hermes agent has not been linked. Run the linking command first.');
  const team = teams.find(t => t.teamId === link.teamId.toLowerCase());
  if (!team) throw Error('The linked TRU HQ team is inactive or missing. Relink explicitly; do not guess by name.');
  if (team.fubSubdomain !== link.fubSubdomain) throw Error('The linked FUB account changed. Review and relink before running.');
  return { teamId: team.teamId, teamName: team.name, fubSubdomain: team.fubSubdomain };
}

export async function saveLink(file, agent, team, expected) {
  await mkdir(dirname(file), { recursive: true });
  const lockPath = `${file}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw Error('Another linking process holds this file. Retry when it finishes.'); throw e; }
  const temp = `${file}.${process.pid}.tmp`;
  try {
    const config = await readLinks(file);
    const index = config.links.findIndex(l => normalize(l.agent) === normalize(agent));
    const current = index < 0 ? null : config.links[index];
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw Error('The saved link changed during confirmation. Run again.');
    const link = { agent, teamId: team.teamId, teamName: team.name,
      fubSubdomain: team.fubSubdomain, confirmedAt: new Date().toISOString() };
    if (index < 0) config.links.push(link); else config.links[index] = link;
    await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await lock.close();
    await unlink(lockPath);
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('Link interactively: node link-hermes-team.mjs --agent "Hermes agent name" --file ./team-links.json [--query "team, leader or FUB account"]\nBrian chat: use --list for candidates, then --team-id ID --confirm only after the user confirms that team in chat.\nResolve for a run: same command with --resolve (JSON output, read-only).\nRequires TRUEHQ_COACH_TOKEN from the existing secret loader. The user never needs to enter a UUID or slug.');
    return;
  }
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--resolve', '--list', '--confirm'].includes(arg)) { opts[arg.slice(2)] = true; continue; }
    if (!['--agent', '--file', '--query', '--team-id', '--confirmation'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Unknown or incomplete option. Use --help.');
    opts[arg.slice(2)] = args[++i];
  }
  if (!normalize(opts.agent ?? '') || !opts.file) throw Error('--agent and --file are required. Use --help.');
  if ((opts.list && opts.resolve) || ((opts.list || opts.resolve) && (opts.confirm || opts['team-id']))
    || (!!opts.confirm !== !!opts['team-id'])) throw Error('Use one mode: --list, --resolve, or --team-id ID --confirm.');
  const file = resolve(opts.file);
  const [teams, config] = await Promise.all([directory(process.env.TRUEHQ_COACH_TOKEN), readLinks(file)]);
  if (opts.resolve) { console.log(JSON.stringify(resolveLink(config, opts.agent, teams))); return; }
  const matches = candidates(teams, opts.query);
  const previous = config.links.find(l => normalize(l.agent) === normalize(opts.agent)) ?? null;
  if (opts.list) { console.log(JSON.stringify({agent: opts.agent, currentLink: previous,
    candidates: matches.map(t => ({...t, confirmation: confirmation(opts.agent, t, previous)}))})); return; }
  if (!matches.length) throw Error('No matching teams. Try the FUB account or omit --query to list all teams.');
  const label = t => `${display(t.name)} | Organization: ${display(t.organizationName || 'not recorded')} | Leaders: ${display(t.leaderNames.join(', ') || 'not recorded')} | FUB: ${display(t.fubSubdomain ? t.fubSubdomain + '.followupboss.com' : 'not recorded')}`;
  function checkSelection(selected) {
    if (!selected) throw Error('The selected team is not in the current candidate list. List teams again.');
    if (matches.filter(t => normalize(label(t)) === normalize(label(selected))).length > 1) throw Error('These records have identical identifying details. Correct the duplicate in TRU HQ before linking.');
    if (!selected.fubSubdomain) throw Error('This team has no FUB account recorded. Complete that field in TRU HQ first.');
  }
  if (opts['team-id']) {
    const selected = matches.find(t => t.teamId === opts['team-id'].toLowerCase());
    checkSelection(selected);
    if (opts.confirmation !== confirmation(opts.agent, selected, previous)) throw Error('Missing or stale confirmation. List teams and confirm the current details in chat again.');
    await saveLink(file, opts.agent, selected, previous);
    console.log(JSON.stringify({linked: true, agent: opts.agent, teamName: selected.name, fubSubdomain: selected.fubSubdomain}));
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Use --list so Brian can show the choices in chat, then --team-id ID --confirm after the user confirms.');
  matches.forEach((t, i) => console.log(`${i + 1}. ${label(t)}`));
  console.log('A directory entry is not proof of a working browser session. Choose the account you already verified.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Team number (Enter to cancel): ')).trim();
    if (!answer) return;
    if (!/^\d+$/.test(answer) || Number(answer) < 1 || Number(answer) > matches.length) throw Error('Invalid selection. No link saved.');
    const selected = matches[Number(answer) - 1];
    checkSelection(selected);
    if (previous) console.log(`Existing link: ${display(previous.teamName)} | FUB: ${display(previous.fubSubdomain)}. This will replace that association.`);
    console.log(`Link ${display(opts.agent)} to ${label(selected)}?`);
    if ((await rl.question('Type yes to confirm: ')).trim().toLowerCase() !== 'yes') { console.log('Cancelled.'); return; }
    // Revalidate identity/account after the human's selection, before saving.
    const latest = (await directory(process.env.TRUEHQ_COACH_TOKEN)).find(t => t.teamId === selected.teamId);
    if (!latest || JSON.stringify(latest) !== JSON.stringify(selected)) throw Error('Team details changed during confirmation. Run again.');
    await saveLink(file, opts.agent, latest, previous);
    console.log(`Linked ${display(opts.agent)} to ${display(latest.name)}. Use --resolve to supply run.teamId and run.teamName to the report publisher.`);
  } finally { rl.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
