import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidates, validateDirectory, resolveLink, readLinks, saveLink, directory, main } from './link-hermes-team.mjs';
const team = {teamId:'aaaaaaaa-1111-4111-8111-111111111111', name:'SB Realty', organizationName:'Example Brokerage', fubSubdomain:'sbrealty', leaderNames:['Alex Leader'], connected:false};

test('Brian chat lists without writes, requires fresh confirmation, saves and resolves', async () => {
  const dir = await mkdtemp(join(tmpdir(),'tru-chat-link-'));
  const originalFetch = globalThis.fetch, originalLog = console.log, token = process.env.TRUEHQ_COACH_TOKEN;
  const output = [];
  let current = team;
  globalThis.fetch = async () => new Response(JSON.stringify({teams:[current]}));
  console.log = value => output.push(JSON.parse(value));
  process.env.TRUEHQ_COACH_TOKEN = 'test-only';
  try {
    const file = join(dir,'links.json');
    const base = ['--agent','existing agent','--file',file];
    await main([...base,'--list']);
    assert.equal((await readLinks(file)).links.length,0);
    const selected = output.pop().candidates[0];
    await assert.rejects(main([...base,'--team-id',selected.teamId,'--confirm']), /confirmation/);
    const confirmed = [...base,'--team-id',selected.teamId,'--confirmation',selected.confirmation,'--confirm'];
    current = {...team,fubSubdomain:'changed'};
    await assert.rejects(main(confirmed), /stale confirmation/);
    current = team;
    await main(confirmed);
    assert.equal(output.pop().linked,true);
    await main([...base,'--resolve']);
    assert.equal(output.pop().teamId,team.teamId);
    await assert.rejects(main(confirmed), /stale confirmation/);
  } finally {
    globalThis.fetch = originalFetch; console.log = originalLog;
    if (token === undefined) delete process.env.TRUEHQ_COACH_TOKEN; else process.env.TRUEHQ_COACH_TOKEN = token;
    await rm(dir,{recursive:true,force:true});
  }
});

test('search ignores case and punctuation across names, organization, leaders and account; duplicates stay separate', () => {
  const duplicate = {...team, teamId:'bbbbbbbb-1111-4111-8111-111111111111', name:'Sb Realty', fubSubdomain:'another'};
  assert.equal(candidates([team,duplicate], 'SB REALTY').length, 2);
  assert.deepEqual(candidates([team], 'alex leader'), [team]);
  assert.deepEqual(candidates([team], 'EXAMPLE-BROKERAGE'), [team]);
  assert.deepEqual(candidates([team,duplicate], 'sbrealty'), [team]);
});
test('directory validation rejects old responses, malformed identities, and duplicate UUIDs', () => {
  assert.throws(() => validateDirectory({teams:[{teamId:team.teamId,name:team.name}]}));
  assert.throws(() => validateDirectory({teams:[team,team]}));
  assert.throws(() => validateDirectory({teams:[{...team,fubSubdomain:'https://wrong.example'}]}));
  assert.deepEqual(validateDirectory({teams:[team]}), [team]);
});
test('saved UUID survives display-name changes; missing teams and changed accounts fail closed', () => {
  const config = {schemaVersion:1,links:[{agent:'SB Realty Agent',...team}]};
  assert.equal(resolveLink(config,'sb-realty-agent',[{...team,name:'Renamed Team'}]).teamName, 'Renamed Team');
  assert.throws(() => resolveLink(config,'sb realty agent',[]), /inactive or missing/);
  assert.throws(() => resolveLink(config,'sb realty agent',[{...team,fubSubdomain:'different'}]), /account changed/);
  assert.throws(() => resolveLink(config,'new agent',[team]), /not been linked/);
});
test('saving is idempotent by normalized agent key and protects a concurrently changed link', async () => {
  const dir = await mkdtemp(join(tmpdir(),'tru-team-link-'));
  try {
    const file = join(dir,'links.json');
    await saveLink(file,'SB Realty Agent',team,null);
    const previous = (await readLinks(file)).links[0];
    await saveLink(file,'sb-realty-agent',{...team,name:'Renamed'},previous);
    const config = await readLinks(file);
    assert.equal(config.links.length,1);
    assert.equal(config.links[0].teamName,'Renamed');
    await assert.rejects(saveLink(file,'SB Realty Agent',team,previous), /changed during confirmation/);
    const stored = await readFile(file,'utf8');
    assert.doesNotMatch(stored,/token|password|secret/i);
    assert.equal((await readLinks(file)).links[0].teamName,'Renamed');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('directory uses only fixed HTTPS destination with redirects disabled; errors do not echo response secrets', async () => {
  const result = await directory('test-token',async (url,opts) => {
    assert.equal(url,'https://api.truhq.co/coach/teams');
    assert.equal(opts.redirect,'error');
    return new Response(JSON.stringify({teams:[team]}));
  });
  assert.deepEqual(result,[team]);
  await assert.rejects(directory('test-token',async () => new Response('secret-value',{status:401})), /HTTP 401/);
  await assert.rejects(directory(''), /TRUEHQ_COACH_TOKEN/);
});
