import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const organizationId = '31006391-ca4f-4c64-a0a3-b4c5013164af';
export const mapping = [
  { project: 'Terrason and TRU API Keys | prod | /Stripe', key: 'STRIPE_SECRET_KEY' },
  { project: 'Terrason and TRU API Keys | prod | /Fathom', key: 'FATHOM_WEBHOOK_SECRET' },
];

export function selectProjects(projects) {
  return mapping.map(({ project, key }) => {
    const matches = projects.filter(p => p.name === project && p.organizationId === organizationId);
    if (matches.length !== 1) throw new Error(`Expected exactly one project: ${project}`);
    return { projectId: matches[0].id, key };
  });
}

export function buildBundle(selected, secrets) {
  const bundle = {};
  for (const { projectId, key } of selected) {
    const matches = secrets.filter(s => s.projectId === projectId && s.key === key && s.organizationId === organizationId);
    if (matches.length !== 1) throw new Error(`Expected exactly one secret: ${key}`);
    const value = matches[0].value;
    if (typeof value !== 'string' || !value.trim() || /\$\{[^}]+\}/.test(value)) {
      throw new Error(`Empty or unresolved secret: ${key}`);
    }
    bundle[key] = value;
  }
  const json = JSON.stringify(bundle);
  if (Buffer.byteLength(json) > 4096) throw new Error('Secret bundle exceeds the delivery size limit');
  return json;
}

function run(file, args, env, input) {
  return new Promise((resolveOutput, reject) => {
    // Never propagate child output on errors: tools may include credential values.
    const child = execFile(file, args, { env, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(new Error('Credential delivery command failed; output suppressed'));
      else resolveOutput(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(a => a !== '--apply') || args.length > 1) throw new Error('Usage: node ops/sync-bitwarden-secrets.mjs [--apply]');
  if (!process.env.BWS_ACCESS_TOKEN) throw new Error('BWS_ACCESS_TOKEN must be supplied by the secure runner');
  const bwsEnv = { ...process.env };
  delete bwsEnv.CLOUDFLARE_API_TOKEN;
  const read = async args => {
    const raw = await run('bws', [...args, '--output', 'json'], bwsEnv);
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch { throw new Error('Unexpected Bitwarden response; output suppressed'); }
  };
  const selected = selectProjects(await read(['project', 'list']));
  const secrets = [];
  for (const { projectId } of selected) secrets.push(...await read(['secret', 'list', projectId]));
  const bundle = buildBundle(selected, secrets);
  console.log('Validated Stripe and Fathom secrets for tru-pulse-sync. Values are not displayed.');
  if (!args.includes('--apply')) {
    console.log('Dry run only. No worker changes made.');
    return;
  }
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Apply requires the verified CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  }
  const workerEnv = { ...process.env };
  delete workerEnv.BWS_ACCESS_TOKEN;
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const config = fileURLToPath(new URL('../wrangler.toml', import.meta.url));
  await run(process.execPath, [wrangler, 'secret', 'put', 'BITWARDEN_TRUHQ_SECRETS', '--name', 'tru-pulse-sync', '--config', config], workerEnv, bundle);
  console.log('Delivered BITWARDEN_TRUHQ_SECRETS to tru-pulse-sync. Verify invoice reads and webhook verification before retiring Infisical.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
