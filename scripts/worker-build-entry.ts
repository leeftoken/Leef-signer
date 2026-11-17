import { buildWorkerSource, DEFAULT_COMPATIBILITY_DATE } from '../src/lib/signer/runtime/generator';
import { leefTraderManifest } from '../src/lib/signer/templates';

const WORKER_NAME = 'leef-trader-ai';

/** Build the production LEEF Trader manifest and self-contained Worker source. */
export function buildProductionWorker() {
  const manifest = leefTraderManifest(WORKER_NAME);
  const source = buildWorkerSource(manifest, DEFAULT_COMPATIBILITY_DATE);
  return { source, manifest };
}
