import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { ArrowLeft, CheckCircle2, Download, KeyRound, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, StepHeader } from '@/components/deploy/common';
import { listSecretNames, putSecret, verifyCredentials, type CloudflareCredentials } from '@/lib/signer/cloudflare';
import {
  DEFAULT_OWNER_CHAT_ID,
  DEFAULT_WORKER_NAME,
  OWNER_SECRET_FIELDS,
  buildHostEnv,
  randomToken,
  secretsToStore,
  validateOwnerSecrets,
  type OwnerSecretValues,
} from '@/lib/signer/ownerSecrets';

/**
 * Owner secrets: enter the AI keys and the Telegram bot token once. Values go from this tab straight to the
 * Cloudflare secrets API of YOUR Worker (write-only, encrypted at rest). Nothing is stored here or sent anywhere else.
 */
const OwnerSecrets = () => {
  useSeoMeta({ title: 'Owner secrets — LEEF Trader Signer', description: 'Set the AI keys and Telegram bot token on your own Worker, write-only.' });

  const [cred, setCred] = useState<CloudflareCredentials>({ accountId: '', apiToken: '' });
  const [worker, setWorker] = useState(DEFAULT_WORKER_NAME);
  const [workersHost, setWorkersHost] = useState('');
  const [values, setValues] = useState<OwnerSecretValues>({ OWNER_CHAT_ID: DEFAULT_OWNER_CHAT_ID });
  const [names, setNames] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<string[]>([]);
  const [hostEnv, setHostEnv] = useState<string | null>(null);

  const errors = validateOwnerSecrets(values);
  const credOk = cred.accountId.trim().length > 0 && cred.apiToken.trim().length > 0 && worker.trim().length > 0;
  const c = () => ({ accountId: cred.accountId.trim(), apiToken: cred.apiToken.trim() });

  async function connect() {
    setBusy(true); setError(null); setNames(null);
    try {
      const v = await verifyCredentials(c());
      if (!v.tokenValid) throw new Error('Cloudflare token is not active');
      setNames(await listSecretNames(c(), worker.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach your Worker');
    } finally { setBusy(false); }
  }

  async function store() {
    setBusy(true); setError(null); setStored([]); setHostEnv(null);
    try {
      const toStore = secretsToStore(values);
      // A notify token is generated here when the bot token is set, so the host can alert through /api/notify.
      const tgToken = (values.TELEGRAM_BOT_TOKEN ?? '').trim();
      const notifyToken = tgToken ? randomToken() : '';
      if (notifyToken) toStore.push(['NOTIFY_TOKEN', notifyToken]);
      for (const [name, text] of toStore) await putSecret(c(), worker.trim(), name, text);
      setStored(toStore.map(([n]) => n));
      setNames(await listSecretNames(c(), worker.trim()));
      // The host file is built now (in memory only) because the plain values are about to be cleared from the form.
      setHostEnv(buildHostEnv({
        telegramBotToken: tgToken,
        ownerChatId: values.OWNER_CHAT_ID,
        typesafeKey: values.TYPESAFE_API_KEY,
        notifyUrl: notifyToken && workersHost.trim() ? `https://${workersHost.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/api/notify` : '',
        notifyToken,
      }));
      setValues({ OWNER_CHAT_ID: values.OWNER_CHAT_ID });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Storing failed');
    } finally { setBusy(false); }
  }

  function downloadHostEnv() {
    if (!hostEnv) return;
    const url = URL.createObjectURL(new Blob([hostEnv], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'leef.env'; a.click();
    URL.revokeObjectURL(url);
    setHostEnv(null); // one download, then gone from memory
  }

  const nothingToStore = secretsToStore(values).filter(([n]) => n !== 'OWNER_CHAT_ID').length === 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b sticky top-0 bg-background/80 backdrop-blur z-10">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">LEEF Trader Signer</span>
          </Link>
          <div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4 text-primary" />Owner secrets</div>
          <div className="w-24" />
        </div>
      </header>
      <main className="container max-w-2xl py-10 space-y-8">
        <StepHeader title="Owner secrets" sub="Enter your AI keys and Telegram bot token once. They are stored as encrypted secrets on YOUR Worker and can never be read back." />
        <Alert className="border-primary/30 bg-primary/5">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Write-only, from this tab only</AlertTitle>
          <AlertDescription>
            Values go straight from your browser to the Cloudflare secrets API. Cloudflare never returns a secret value, this
            app stores nothing, and the bots only call your Worker. WAX keys never belong here: type them on your VPS.
          </AlertDescription>
        </Alert>

        <section className="space-y-4">
          <h3 className="font-semibold">1. Your Worker</h3>
          <Field label="Cloudflare Account ID"><Input value={cred.accountId} onChange={(e) => setCred({ ...cred, accountId: e.target.value })} autoComplete="off" /></Field>
          <Field label="Cloudflare API Token" hint="Workers Scripts:Edit on your account. This is your owner login for this page; it never leaves the tab.">
            <Input type="password" value={cred.apiToken} onChange={(e) => setCred({ ...cred, apiToken: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Worker name"><Input value={worker} onChange={(e) => setWorker(e.target.value)} autoComplete="off" /></Field>
          <Field label="Worker host (optional)" hint="e.g. leef-trader-ai.<you>.workers.dev, used to fill LEEF_NOTIFY_URL in leef.env.">
            <Input value={workersHost} onChange={(e) => setWorkersHost(e.target.value)} autoComplete="off" />
          </Field>
          <Button variant="outline" onClick={connect} disabled={!credOk || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Connect and show configured secrets
          </Button>
          {names && (
            <p className="text-sm text-muted-foreground">
              Configured on <code>{worker}</code>: {names.length ? names.join(', ') : 'none yet'}
            </p>
          )}
        </section>

        <section className="space-y-4">
          <h3 className="font-semibold">2. Secrets (leave a field empty to keep the current value)</h3>
          {OWNER_SECRET_FIELDS.map((f) => (
            <Field key={f.name} label={`${f.label}${names?.includes(f.name) ? ' (set)' : ''}`} hint={f.hint} error={errors[f.name]}>
              <Input
                type={f.secret ? 'password' : 'text'}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          ))}
          <Button onClick={store} disabled={!credOk || busy || Object.keys(errors).length > 0 || nothingToStore}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Store on my Worker
          </Button>
          {stored.length > 0 && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Stored: {stored.join(', ')}</AlertTitle>
              <AlertDescription>The form was cleared. Values cannot be shown again, only replaced.</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive"><XCircle className="h-4 w-4" /><AlertTitle>Failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
          )}
        </section>

        {hostEnv && (
          <section className="space-y-3">
            <h3 className="font-semibold">3. VPS secrets file (optional)</h3>
            <p className="text-sm text-muted-foreground">
              A <code>leef.env</code> for <code>deploy/vps-setup.sh --env</code>, built in this tab. It holds the report token, chat id
              and notify token, with blank WAX key lines to fill in on the VPS. One download, then it is gone from this page.
            </p>
            <Button variant="outline" onClick={downloadHostEnv}><Download className="h-4 w-4 mr-2" />Download leef.env</Button>
          </section>
        )}
      </main>
    </div>
  );
};

export default OwnerSecrets;
