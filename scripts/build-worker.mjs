import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outputDir = resolve(root, 'dist-worker');
const outputFile = resolve(outputDir, 'worker.mjs');
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { buildProductionWorker } = await server.ssrLoadModule('/scripts/worker-build-entry.ts');
  const { source, manifest } = buildProductionWorker();
  const commit = process.env.GITHUB_SHA ?? 'local';
  const generated = `/* Generated from Leef-signer source. Commit: ${commit}. Do not edit. */\n${source}`;
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, generated, 'utf8');

  const syntax = spawnSync(process.execPath, ['--check', outputFile], { stdio: 'inherit' });
  if (syntax.status !== 0) process.exit(syntax.status ?? 1);

  if (!generated.includes('PPQ_API_KEY') || !generated.includes('TYPESAFE_API_KEY')) {
    throw new Error('Generated production Worker is missing expected provider secret bindings.');
  }
  if (!generated.includes('/api/ai') || !generated.includes('/api/judge') || !generated.includes('/api/notify')) {
    throw new Error('Generated production Worker is missing a required LEEF route.');
  }

  console.log(`Built ${outputFile}`);
  console.log(`Manifest: ${manifest.app}; providers: ${Object.keys(manifest.providers).join(', ')}; routes: ${Object.keys(manifest.routes).join(', ')}`);
} finally {
  await server.close();
}
