// TRU Rep — one-time setup: create the Live Sim "buyer" agent in Retell.
// The persona is injected per-call via the {{persona_prompt}} dynamic variable,
// so ONE agent plays every scenario.
//
// Usage:  RETELL_API_KEY=key node setup_practice_agent.mjs
// Prints the agent id → then run, in TRU Pulse/worker:
//   npx wrangler secret put RETELL_AGENT_ID
const KEY = process.env.RETELL_API_KEY;
if (!KEY) { console.error('Set RETELL_API_KEY in the environment first.'); process.exit(1); }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const R = 'https://api.retellai.com';

async function main() {
  // Pick a natural ElevenLabs voice available on the account.
  const voices = await fetch(`${R}/list-voices`, { headers: H }).then((r) => r.json());
  const preferred = ['11labs-Chloe', '11labs-Anna', '11labs-Amy', '11labs-Kate'];
  const pick = preferred.find((v) => voices.some((x) => x.voice_id === v))
    ?? voices.find((v) => v.provider === 'elevenlabs')?.voice_id
    ?? voices[0]?.voice_id;
  console.log('voice:', pick);

  const llm = await fetch(`${R}/create-retell-llm`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      general_prompt: '{{persona_prompt}}',
      begin_message: 'Hello?',
      model: 'gpt-4o',
    }),
  }).then((r) => r.json());
  if (!llm.llm_id) { console.error('LLM create failed:', llm); process.exit(1); }

  const agent = await fetch(`${R}/create-agent`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      agent_name: 'TRU Rep — Live Sim Buyer',
      voice_id: pick,
      response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
      language: 'en-US',
      enable_backchannel: true,
      interruption_sensitivity: 0.9,
      end_call_after_silence_ms: 20000,
      max_call_duration_ms: 600000, // 10-minute cap per practice call
    }),
  }).then((r) => r.json());
  if (!agent.agent_id) { console.error('Agent create failed:', agent); process.exit(1); }

  console.log('\n✓ Live Sim buyer created.');
  console.log('RETELL_AGENT_ID =', agent.agent_id);
  console.log('\nNext, in TRU Pulse/worker run:  npx wrangler secret put RETELL_AGENT_ID');
}
main().catch((e) => { console.error(e); process.exit(1); });
