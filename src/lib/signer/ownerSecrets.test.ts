import { describe, expect, it } from 'vitest';
import { buildHostEnv, randomToken, secretsToStore, validateOwnerSecrets } from './ownerSecrets';

describe('ownerSecrets', () => {
  it('accepts valid values and leaves empty fields untouched', () => {
    expect(validateOwnerSecrets({ TELEGRAM_BOT_TOKEN: '123456789:' + 'A'.repeat(35), OWNER_CHAT_ID: '149087654', PPQ_API_KEY: '' })).toEqual({});
    expect(secretsToStore({ PPQ_API_KEY: '  ', OWNER_CHAT_ID: ' 149087654 ' })).toEqual([['OWNER_CHAT_ID', '149087654']]);
  });
  it('rejects malformed values', () => {
    const e = validateOwnerSecrets({ TELEGRAM_BOT_TOKEN: 'nope', OWNER_CHAT_ID: 'abc', PPQ_API_KEY: 'short' });
    expect(Object.keys(e).sort()).toEqual(['OWNER_CHAT_ID', 'PPQ_API_KEY', 'TELEGRAM_BOT_TOKEN']);
    expect(validateOwnerSecrets({ PPQ_API_KEY: 'a'.repeat(20) + ' b' }).PPQ_API_KEY).toMatch(/spaces/);
  });
  it('random tokens are long and unique', () => {
    const a = randomToken(); const b = randomToken();
    expect(a).not.toEqual(b); expect(a.length).toBeGreaterThanOrEqual(43); expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('host env has blank WAX keys, no AI gateway key, and the owner chat default', () => {
    const env = buildHostEnv({ telegramBotToken: 't', notifyUrl: 'https://x/api/notify', notifyToken: 'n' });
    expect(env).toMatch(/^WAX_KEY_DANISHCRYPTO=$/m);
    expect(env).toMatch(/^WAX_KEY_SMARTABOT111_BOT=$/m);
    expect(env).toMatch(/^LEEF_REPORT_CHAT_ID=149087654$/m);
    expect(env).toMatch(/^LEEF_NOTIFY_TOKEN=n$/m);
    expect(env).not.toMatch(/PPQ_API_KEY/);
    expect(env).not.toMatch(/^export /m);
  });
});
