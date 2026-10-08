// Staff gate for endpoints that return Piano Log / customer records.
//
// A browser request must carry the Google ID token the Store Map already
// keeps after "Sign in with Google" (Authorization: Bearer, or the same
// x-blp-idtoken header agent chat uses). The token is checked here:
//   - RS256 signature against Google's published certs
//   - issuer, expiry, audience = this app's OAuth client ID
//   - email_verified, and both `hd` and the email domain =
//     brighamlarsonpianos.com (Google Workspace only)
//
// Server jobs (the Apps Script daily report, Top 10 brief, local dev) send
// header x-blp-data-key. The value is BLP_DATA_SECRET from the environment.
// It is never committed. A missing or short secret does not unlock anything.
//
// These responses never include Access-Control-Allow-Origin. Same-origin
// Store Map requests do not need CORS; a wildcard would let any website
// read customer records from a visitor's browser.

import { createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';

export const WORKSPACE_DOMAIN = 'brighamlarsonpianos.com';
// Public web client in karmel@'s "BLP Store Map" Google Cloud project.
// Same value as GOOGLE_CLIENT_ID in app.js. Override with the
// GOOGLE_CLIENT_ID env var if that client is rotated.
export const DEFAULT_GOOGLE_CLIENT_ID =
  '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com';
export const DATA_KEY_HEADER = 'x-blp-data-key';
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const MIN_SECRET_LEN = 16;
const CLOCK_SKEW_MS = 120000;
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export const SIGN_IN_ERROR = 'Sign in with your Brigham Larson Pianos Google account.';
export const DOMAIN_ERROR = 'This Google account is not a @brighamlarsonpianos.com account.';
export const VERIFY_ERROR = 'Could not verify Google sign-in. Try again in a moment.';

export function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID).trim();
}

let certCache = { keys: null, exp: 0 };

export function __resetCertCacheForTests() {
  certCache = { keys: null, exp: 0 };
}

function b64urlToBuffer(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function decodeJson(part) {
  return JSON.parse(b64urlToBuffer(part).toString('utf8'));
}

export function serviceSecretOk(presented, expected = process.env.BLP_DATA_SECRET || '') {
  const want = String(expected || '');
  const got = presented == null ? '' : String(presented);
  if (want.length < MIN_SECRET_LEN || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function tokenFrom(req) {
  const auth = req.headers.get('authorization') || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return (req.headers.get('x-blp-idtoken') || '').trim();
}

function fail(status, error, reason) {
  return { ok: false, status, error, reason };
}

// Pure check. `certs` is the `keys` array from Google's certs document
// (or a test key). No network.
export function verifyGoogleIdToken(token, {
  certs = [],
  clientId = googleClientId(),
  now = Date.now(),
  domain = WORKSPACE_DOMAIN,
} = {}) {
  const raw = String(token || '');
  if (!raw || raw.length > 8192) return fail(401, SIGN_IN_ERROR, 'missing');
  const parts = raw.split('.');
  if (parts.length !== 3) return fail(401, SIGN_IN_ERROR, 'malformed');
  let header;
  try { header = decodeJson(parts[0]); } catch (e) { return fail(401, SIGN_IN_ERROR, 'malformed'); }
  // Reject "none" and anything other than RS256 before looking at the signature.
  if (!header || header.alg !== 'RS256' || !header.kid) return fail(401, SIGN_IN_ERROR, 'alg');
  if (!parts[1] || !parts[2]) return fail(401, SIGN_IN_ERROR, 'malformed');
  let payload;
  try { payload = decodeJson(parts[1]); } catch (e) { return fail(401, SIGN_IN_ERROR, 'malformed'); }
  const jwk = (certs || []).find((k) => k && k.kid === header.kid);
  if (!jwk) return fail(401, SIGN_IN_ERROR, 'unknown-kid');
  let pub;
  try {
    pub = createPublicKey({
      key: { kty: 'RSA', n: jwk.n, e: jwk.e },
      format: 'jwk',
    });
  } catch (e) {
    return fail(401, SIGN_IN_ERROR, 'bad-key');
  }
  const signed = Buffer.from(parts[0] + '.' + parts[1]);
  let sigOk = false;
  try {
    sigOk = cryptoVerify('RSA-SHA256', signed, pub, b64urlToBuffer(parts[2]));
  } catch (e) {
    sigOk = false;
  }
  if (!sigOk) return fail(401, SIGN_IN_ERROR, 'bad-signature');

  const iss = String(payload.iss || '');
  if (!ISSUERS.has(iss)) return fail(401, SIGN_IN_ERROR, 'iss');
  const aud = payload.aud;
  const audOk = Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
  if (!clientId || !audOk) return fail(401, SIGN_IN_ERROR, 'aud');
  const exp = Number(payload.exp);
  if (!exp || exp * 1000 < now - CLOCK_SKEW_MS) return fail(401, SIGN_IN_ERROR, 'exp');
  if (payload.nbf && Number(payload.nbf) * 1000 > now + CLOCK_SKEW_MS) return fail(401, SIGN_IN_ERROR, 'nbf');
  const verified = payload.email_verified === true || String(payload.email_verified) === 'true';
  if (!verified) return fail(401, SIGN_IN_ERROR, 'email_verified');

  const email = String(payload.email || '').toLowerCase();
  const hd = String(payload.hd || '').toLowerCase();
  const want = String(domain || WORKSPACE_DOMAIN).toLowerCase();
  if (hd !== want || !email.endsWith('@' + want)) return fail(403, DOMAIN_ERROR, 'domain');
  return {
    ok: true,
    via: 'google',
    email,
    name: payload.name || email,
    hd,
  };
}

export async function fetchGoogleCerts(fetchImpl = globalThis.fetch) {
  const now = Date.now();
  if (certCache.keys && now < certCache.exp) return certCache.keys;
  const r = await fetchImpl(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('google certs ' + r.status);
  const body = await r.json();
  let ttl = 60 * 60 * 1000;
  const cc = (r.headers && r.headers.get && r.headers.get('cache-control')) || '';
  const m = /max-age=(\d+)/.exec(cc);
  if (m) ttl = Math.max(60 * 1000, Number(m[1]) * 1000);
  certCache = { keys: body.keys || [], exp: now + ttl };
  return certCache.keys;
}

export async function authorizeDataRequest(req, opts = {}) {
  const presented = req.headers.get(DATA_KEY_HEADER);
  if (serviceSecretOk(presented, opts.secret)) return { ok: true, via: 'secret' };
  const token = tokenFrom(req);
  if (!token) return fail(401, SIGN_IN_ERROR, 'missing');
  const clientId = opts.clientId || googleClientId();
  const now = opts.now || Date.now();
  const domain = opts.domain || WORKSPACE_DOMAIN;
  try {
    let certs = opts.certs;
    const provided = !!opts.certs;
    if (!provided) certs = await fetchGoogleCerts(opts.fetchCerts);
    let result = verifyGoogleIdToken(token, { certs, clientId, now, domain });
    // Google rotates signing keys. If this token's kid is new, refresh once.
    if (!result.ok && result.reason === 'unknown-kid' && !provided) {
      certCache = { keys: null, exp: 0 };
      certs = await fetchGoogleCerts(opts.fetchCerts);
      result = verifyGoogleIdToken(token, { certs, clientId, now, domain });
    }
    return result;
  } catch (e) {
    return fail(503, VERIFY_ERROR, 'certs');
  }
}

// JSON error with no piano/customer fields and no CORS header.
export function denyResponse(auth) {
  return Response.json(
    { error: (auth && auth.error) || SIGN_IN_ERROR },
    {
      status: (auth && auth.status) || 401,
      headers: { 'cache-control': 'private, no-store' },
    },
  );
}
