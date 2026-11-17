import { readFile } from 'node:fs/promises';

const accountId = process.env.CF_ACCOUNT_ID;
const apiToken = process.env.CF_API_TOKEN;
const workerName = process.env.WORKER_NAME ?? 'leef-trader-ai';
const workerHost = process.env.WORKER_SUBDOMAIN ?? `${workerName}.workers.dev`;

if (!accountId || !apiToken) {
  throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN are required.');
}
if (!/^[a-f0-9]{32}$/i.test(accountId)) {
  throw new Error('CF_ACCOUNT_ID must be a 32-character Cloudflare account ID.');
}

const source = await readFile(new URL('../dist-worker/worker.mjs', import.meta.url), 'utf8');
const metadata = {
  main_module: 'worker.mjs',
  compatibility_date: '2026-08-01',
  // Preserve credentials configured directly in Cloudflare. The model is a
  // non-secret setting and is explicitly kept aligned with the repo preset.
  keep_bindings: ['secret_text'],
  bindings: [
    { name: 'PPQ_MODEL', type: 'plain_text', text: 'openai/gpt-oss-20b' },
  ],
};

const form = new FormData();
form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
form.set('worker.mjs', new Blob([source], { type: 'application/javascript+module' }), 'worker.mjs');

const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`;
const upload = await fetch(apiUrl, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${apiToken}` },
  body: form,
});
const uploadBody = await upload.json().catch(() => null);
if (!upload.ok || !uploadBody?.success) {
  const errors = (uploadBody?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
  throw new Error(`Cloudflare Worker upload failed (HTTP ${upload.status}): ${errors || 'unknown API error'}`);
}

console.log(`Cloudflare accepted Worker upload for ${workerName}.`);

// Confirm the live Worker serves the newly deployed status contract. This
// endpoint exposes binding booleans/names only; never request secret values.
const statusUrl = `https://${workerHost}/api/status`;
let statusResponse;
let status;
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    statusResponse = await fetch(statusUrl, { headers: { Accept: 'application/json' } });
    status = await statusResponse.json();
    if (statusResponse.ok && status?.app && status?.providers) break;
  } catch {
    // Cloudflare propagation can briefly lag behind a successful upload.
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!statusResponse?.ok || !status?.providers) {
  throw new Error('Worker upload succeeded, but the live /api/status verification did not pass.');
}

const ai = status.providers.ai;
const judge = status.providers.judge;
if (!ai?.configured || !judge?.configured) {
  throw new Error('Worker is live, but one or more required provider secrets are not configured (AI/PPQ or TypeSafe/Jev).');
}

console.log('Live /api/status verification passed.');
console.log(`Providers configured: AI=${Boolean(ai.configured)}, Jev=${Boolean(judge.configured)}.`);
console.log('Secret values were neither read nor printed.');
