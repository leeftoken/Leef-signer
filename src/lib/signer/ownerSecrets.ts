/**
 * Owner secrets ("host secrets" step, docs/AUTOMATION.md phase 3).
 *
 * The owner enters the AI keys and the Telegram bot token ONCE. They go straight from this browser tab to the
 * Cloudflare secrets API of the owner's own Worker (encrypted at rest by Cloudflare, write-only: no API ever returns a
 * secret value). Nothing is stored in this app, localStorage, logs or any other server. Owner auth = the owner's own
 * Cloudflare API token (Workers Scripts:Edit), which never leaves the tab either.
 *
 * What reads them afterwards (never the value itself, only the Worker uses it server-side):
 *   PPQ_API_KEY        -> /api/ai        (serverless bot free-text answers, LEEF Trader analysis)
 *   TYPESAFE_API_KEY   -> /api/judge
 *   TELEGRAM_BOT_TOKEN -> /api/notify    (owner-only alerts; chat id fixed server-side by OWNER_CHAT_ID)
 * The VPS gets its own file: buildHostEnv() builds leef.env IN THE BROWSER for download (WAX keys are typed on the VPS,
 * never here).
 */

export type OwnerSecretName = 'PPQ_API_KEY' | 'TYPESAFE_API_KEY' | 'TELEGRAM_BOT_TOKEN' | 'OWNER_CHAT_ID' | 'NOTIFY_TOKEN';

export interface OwnerSecretField {
  name: OwnerSecretName;
  label: string;
  hint: string;
  /** Shown as a password input. */
  secret: boolean;
}

export const OWNER_SECRET_FIELDS: OwnerSecretField[] = [
  { name: 'PPQ_API_KEY', label: 'AI key (PayPerQ)', hint: 'Used by /api/ai for the bot\'s free-text answers and LEEF Trader analysis.', secret: true },
  { name: 'TYPESAFE_API_KEY', label: 'TypeSafe / Jev key (optional)', hint: 'Used by /api/judge.', secret: true },
  { name: 'TELEGRAM_BOT_TOKEN', label: 'Telegram bot token', hint: 'From @BotFather. Used only by /api/notify to message the owner chat.', secret: true },
  { name: 'OWNER_CHAT_ID', label: 'Owner Telegram chat id', hint: 'Numeric. /api/notify can only ever send here.', secret: false },
];

export const DEFAULT_OWNER_CHAT_ID = '149087654';
export const DEFAULT_WORKER_NAME = 'leef-trader-ai';

const TG_TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
const CHAT_RE = /^-?\d{3,20}$/;

export type OwnerSecretValues = Partial<Record<OwnerSecretName, string>>;

/** Validate what the owner typed. Empty = leave the existing Worker secret untouched. Returns field -> error. */
export function validateOwnerSecrets(v: OwnerSecretValues): Partial<Record<OwnerSecretName, string>> {
  const errors: Partial<Record<OwnerSecretName, string>> = {};
  const t = (k: OwnerSecretName) => (v[k] ?? '').trim();
  if (t('PPQ_API_KEY') && t('PPQ_API_KEY').length < 16) errors.PPQ_API_KEY = 'Looks too short for an API key';
  if (t('TYPESAFE_API_KEY') && t('TYPESAFE_API_KEY').length < 16) errors.TYPESAFE_API_KEY = 'Looks too short for an API key';
  if (t('TELEGRAM_BOT_TOKEN') && !TG_TOKEN_RE.test(t('TELEGRAM_BOT_TOKEN'))) errors.TELEGRAM_BOT_TOKEN = 'Expected the BotFather format 123456789:AA…';
  if (t('OWNER_CHAT_ID') && !CHAT_RE.test(t('OWNER_CHAT_ID'))) errors.OWNER_CHAT_ID = 'Must be a numeric chat id';
  for (const k of Object.keys(v) as OwnerSecretName[]) if (/\s/.test(t(k))) errors[k] = 'Must not contain spaces or line breaks';
  return errors;
}

/** Only the non-empty, trimmed values: these are the secrets to PUT. */
export function secretsToStore(v: OwnerSecretValues): Array<[OwnerSecretName, string]> {
  return (Object.entries(v) as Array<[OwnerSecretName, string | undefined]>)
    .map(([k, x]) => [k, (x ?? '').trim()] as [OwnerSecretName, string])
    .filter(([, x]) => x.length > 0);
}

/** 32 random bytes, base64url. Used for NOTIFY_TOKEN (shared only with the owner's host via leef.env). */
export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The VPS secrets file (deploy/vps-setup.sh --env). Built in the browser and downloaded; never uploaded anywhere.
 * WAX keys are left blank on purpose: type them on the VPS itself.
 */
export function buildHostEnv(opts: {
  telegramBotToken?: string;
  ownerChatId?: string;
  typesafeKey?: string;
  notifyUrl?: string;
  notifyToken?: string;
}): string {
  const line = (k: string, v = '') => `${k}=${v}`;
  return [
    '# leef.env for the LEEF VPS (deploy/vps-setup.sh --env leef.env). Keep it chmod 600. Never commit, paste or send it.',
    '# Generated in your browser by the Leef signer; nothing was uploaded. Fill the WAX keys ON THE VPS.',
    line('LEEF_ACCOUNTS', 'mywaxgallery,niftywarlord,dustwizard42,smart.ass,danishcrypto,skgaw.wam,qu.ui.wam'),
    '# one active (or narrow custom) key per wallet - never owner keys',
    line('WAX_BOT_ACTIVE_KEY'), line('WAX_KEY_NIFTYWARLORD'), line('WAX_KEY_DUSTWIZARD42'), line('WAX_KEY_SMARTASS'),
    line('WAX_KEY_DANISHCRYPTO'), line('WAX_KEY_SKGAW_WAM'), line('WAX_KEY_QU_UI_WAM'),
    '# smartabot111@bot only (keeper)',
    line('WAX_KEY_SMARTABOT111_BOT'),
    '# reports + failure alerts',
    line('LEEF_REPORT_BOT_TOKEN', (opts.telegramBotToken ?? '').trim()),
    line('LEEF_REPORT_CHAT_ID', (opts.ownerChatId ?? '').trim() || DEFAULT_OWNER_CHAT_ID),
    line('TYPESAFE_API_KEY', (opts.typesafeKey ?? '').trim()),
    '# optional: alerts through the Worker (/api/notify) instead of holding the bot token',
    line('LEEF_NOTIFY_URL', (opts.notifyUrl ?? '').trim()),
    line('LEEF_NOTIFY_TOKEN', (opts.notifyToken ?? '').trim()),
    '',
  ].join('\n');
}
