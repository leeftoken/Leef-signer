/**
 * Worker entry — the single default-export fetch handler. Serialized into
 * the generated module. The MANIFEST const is injected by generator.ts
 * (as a JSON literal) directly before this section.
 *
 * Plain JavaScript on purpose (see core.js): the generated worker must be
 * valid ECMAScript — Cloudflare does not transpile TypeScript on upload.
 */

/* global MANIFEST, makeRequestId, handlePreflight, jsonResponse, errorResponse, applyCors, checkPublicAuth, rateLimit, dispatchProvider, healthCheckProvider, getSecret, readJsonBody */
/* (symbols above are provided by core.js / providers.js / the manifest,   */
/*  concatenated by generator.ts)                                          */

/**
 * Non-secret status — never leaks secrets, only which bindings are set.
 * @param {Record<string, unknown>} env
 * @returns {Record<string, unknown>}
 */
function publicStatus(env) {
  const providers = {};
  for (const [id, cfg] of Object.entries(MANIFEST.providers)) {
    const c = cfg;
    const secretName =
      (typeof c.secretName === 'string' ? c.secretName : undefined) ??
      (c.auth && typeof c.auth === 'object' && typeof c.auth.secretName === 'string'
        ? c.auth.secretName
        : undefined);
    providers[id] = {
      type: c.type,
      configured: secretName ? typeof env[secretName] === 'string' && env[secretName].length > 0 : true,
    };
  }
  return {
    app: MANIFEST.app,
    runtimeVersion: MANIFEST.version,
    routes: Object.keys(MANIFEST.routes),
    providers,
    // Owner secrets set from the signer's "Owner secrets" page: names/booleans only, never values.
    ownerSecrets: {
      telegramBotToken: Boolean(getSecret(env, 'TELEGRAM_BOT_TOKEN')),
      notify: notifyConfigured(env),
    },
  };
}

/**
 * Owner notify route (optional, built in). Lets the owner's host / ops jobs send a Telegram message to the OWNER chat
 * without holding the bot token: the token lives only as the Worker secret TELEGRAM_BOT_TOKEN (set from the Leef signer
 * "Owner secrets" page) and is never returned. Enabled only when TELEGRAM_BOT_TOKEN, NOTIFY_TOKEN and OWNER_CHAT_ID are
 * all set. The destination chat is fixed server-side, so a leaked NOTIFY_TOKEN can only message the owner.
 */
const NOTIFY_RULE = { keyBy: 'ip', requestsPerMinute: 10 };

/** Constant-time string compare (length leak only). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function notifyConfigured(env) {
  return Boolean(getSecret(env, 'TELEGRAM_BOT_TOKEN') && getSecret(env, 'NOTIFY_TOKEN') && /^-?\d{3,20}$/.test(getSecret(env, 'OWNER_CHAT_ID') ?? ''));
}

/** @param {Request} request @param {Record<string, unknown>} env @param {string[]} allowed @param {string} requestId */
async function handleNotify(request, env, allowed, requestId) {
  if (!notifyConfigured(env)) return errorResponse('NOT_FOUND', 'Unknown route', 404, request, allowed, requestId);
  // Server-to-server only: a browser Origin is never accepted here.
  if (request.headers.get('Origin')) return errorResponse('FORBIDDEN', 'Not available from browsers', 403, request, allowed, requestId);
  const header = request.headers.get('Authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!safeEqual(bearer, getSecret(env, 'NOTIFY_TOKEN'))) return errorResponse('UNAUTHORIZED', 'Valid credentials required', 401, request, allowed, requestId);
  const retryAfter = rateLimit(request, NOTIFY_RULE, '/api/notify');
  if (retryAfter > 0) return errorResponse('RATE_LIMITED', 'Too many requests', 429, request, allowed, requestId, retryAfter);
  let body;
  try { body = await readJsonBody(request, 16_384); } catch { return errorResponse('INVALID_REQUEST', 'Body must be JSON', 400, request, allowed, requestId); }
  const text = body && typeof body.text === 'string' ? body.text.trim().slice(0, 3800) : '';
  if (!text) return errorResponse('INVALID_REQUEST', 'text is required', 400, request, allowed, requestId);
  let upstream;
  try {
    upstream = await fetch(`https://api.telegram.org/bot${getSecret(env, 'TELEGRAM_BOT_TOKEN')}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: getSecret(env, 'OWNER_CHAT_ID'), text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return errorResponse('PROVIDER_UNAVAILABLE', 'Telegram unreachable', 502, request, allowed, requestId);
  }
  await upstream.body?.cancel().catch(() => undefined);
  if (!upstream.ok) return errorResponse('UPSTREAM_ERROR', `Telegram returned HTTP ${upstream.status}`, 502, request, allowed, requestId);
  return jsonResponse({ ok: true }, 200, request, allowed);
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, unknown>} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const allowed = MANIFEST.security.allowedOrigins;
    const requestId = makeRequestId();

    try {
      if (path.startsWith('/api/') && request.method === 'OPTIONS') {
        return handlePreflight(request, allowed);
      }

      // Built-in status endpoint — never leaks secrets.
      if (path === '/api/status' && request.method === 'GET') {
        return jsonResponse(publicStatus(env), 200, request, allowed);
      }

      // Built-in health endpoint — probes each provider's reachability.
      if (path === '/api/health' && request.method === 'GET') {
        const checks = [];
        for (const [id, cfg] of Object.entries(MANIFEST.providers)) {
          const c = cfg;
          checks.push(await healthCheckProvider(id, String(c.type), c, env));
        }
        const ok = checks.every((c) => c.ok);
        return jsonResponse({ ok, checks }, ok ? 200 : 207, request, allowed);
      }

      if (path === '/api/notify' && request.method === 'POST') {
        return await handleNotify(request, env, allowed, requestId);
      }

      const providerId = MANIFEST.routes[path];
      if (!providerId) {
        return errorResponse('NOT_FOUND', 'Unknown route', 404, request, allowed, requestId);
      }
      const cfg = MANIFEST.providers[providerId];
      if (!cfg) {
        return errorResponse('CONFIGURATION_ERROR', 'Route has no provider', 500, request, allowed, requestId);
      }

      // Public gateway auth (separate from upstream provider secrets).
      if (!checkPublicAuth(request, MANIFEST, env)) {
        return errorResponse('UNAUTHORIZED', 'Valid credentials required', 401, request, allowed, requestId);
      }

      // Rate limit: route-specific rule wins, else the default.
      const rule = MANIFEST.limits.perRoute[path] ?? MANIFEST.limits.default;
      const retryAfter = rateLimit(request, rule, path);
      if (retryAfter > 0) {
        return errorResponse('RATE_LIMITED', 'Too many requests', 429, request, allowed, requestId, retryAfter);
      }

      const result = await dispatchProvider(String(cfg.type), {
        request,
        env,
        manifest: MANIFEST,
        allowed,
        requestId,
      }, cfg);
      // Ensure CORS header present even if a provider built its own response.
      applyCors(result.response.headers, request, allowed);
      return result.response;
    } catch {
      // Deliberately opaque: internal errors must not leak config details.
      return errorResponse('INTERNAL', 'Internal error', 500, request, allowed, requestId);
    }
  },
};
