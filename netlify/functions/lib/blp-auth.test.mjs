import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  authorizeDataRequest,
  DATA_KEY_HEADER,
  DEFAULT_GOOGLE_CLIENT_ID,
  denyResponse,
  DOMAIN_ERROR,
  fetchGoogleCerts,
  serviceSecretOk,
  SIGN_IN_ERROR,
  verifyGoogleIdToken,
  WORKSPACE_DOMAIN,
  __resetCertCacheForTests,
} from './blp-auth.mjs';
import { handleData } from '../data.mjs';
import { handleTop10 } from '../top10.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const CERTS = [{ kid: 'test-key', kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' }];
const CLIENT = 'test-client.apps.googleusercontent.com';
const NOW = Date.parse('2026-10-08T12:00:00Z');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeToken(payload, { kid = 'test-key', priv = privateKey, alg = 'RS256', sig } = {}) {
  const header = { alg, typ: 'JWT', kid };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  if (sig !== undefined) return `${data}.${sig}`;
  if (alg === 'none') return `${data}.`;
  const signature = sign('RSA-SHA256', Buffer.from(data), priv);
  return `${data}.${b64url(signature)}`;
}

function staffPayload(over = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT,
    exp: Math.floor(NOW / 1000) + 3600,
    iat: Math.floor(NOW / 1000),
    email: 'lisa@brighamlarsonpianos.com',
    email_verified: true,
    hd: WORKSPACE_DOMAIN,
    name: 'Lisa',
    ...over,
  };
}

function req(headers = {}, url = 'https://blpstoremap.netlify.app/api/data') {
  return new Request(url, { headers });
}

const authOpts = { certs: CERTS, clientId: CLIENT, now: NOW };

test('accepts a Workspace ID token whose signature, audience, hd, and email domain match', () => {
  const token = makeToken(staffPayload());
  const out = verifyGoogleIdToken(token, authOpts);
  assert.equal(out.ok, true);
  assert.equal(out.email, 'lisa@brighamlarsonpianos.com');
  assert.equal(out.hd, WORKSPACE_DOMAIN);
});

test('rejects a missing token, a bad signature, the wrong audience, and an expired token', () => {
  assert.equal(verifyGoogleIdToken('', authOpts).status, 401);
  const good = makeToken(staffPayload());
  const flipped = good.slice(0, -4) + (good.endsWith('aaaa') ? 'bbbb' : 'aaaa');
  assert.equal(verifyGoogleIdToken(flipped, authOpts).reason, 'bad-signature');
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal(verifyGoogleIdToken(makeToken(staffPayload(), { priv: other.privateKey }), authOpts).reason, 'bad-signature');
  assert.equal(verifyGoogleIdToken(makeToken(staffPayload({ aud: 'other-client' })), authOpts).reason, 'aud');
  assert.equal(verifyGoogleIdToken(makeToken(staffPayload({ aud: [CLIENT, 'extra'] })), authOpts).ok, true);
  assert.equal(verifyGoogleIdToken(makeToken(staffPayload({ exp: Math.floor(NOW / 1000) - 1000 })), authOpts).reason, 'exp');
  assert.equal(verifyGoogleIdToken(makeToken(staffPayload(), { alg: 'none' }), authOpts).reason, 'alg');
  assert.equal(verifyGoogleIdToken(makeToken(staffPayload(), { kid: 'rotated' }), authOpts).reason, 'unknown-kid');
});

test('rejects the wrong hosted domain and non-workspace emails with 403 and no identity echo', () => {
  const cases = [
    staffPayload({ hd: 'gmail.com' }),
    staffPayload({ hd: '' }),
    staffPayload({ email: 'markhales.blp@gmail.com', hd: 'gmail.com' }),
    staffPayload({ email: 'brighamlarson@gmail.com', hd: '' }),
    staffPayload({ email: 'lisa@brighamlarsonpianos.com.evil.com' }),
    staffPayload({ email: 'lisa@notbrighamlarsonpianos.com', hd: 'notbrighamlarsonpianos.com' }),
    staffPayload({ email_verified: false }),
  ];
  for (const payload of cases) {
    const out = verifyGoogleIdToken(makeToken(payload), authOpts);
    assert.equal(out.ok, false, payload.email);
    assert.ok(out.status === 403 || out.status === 401);
    assert.equal(out.email, undefined);
  }
  const wrongDomain = verifyGoogleIdToken(makeToken(staffPayload({ hd: 'gmail.com', email: 'a@gmail.com' })), authOpts);
  assert.equal(wrongDomain.status, 403);
  assert.equal(wrongDomain.error, DOMAIN_ERROR);
  const unverified = verifyGoogleIdToken(makeToken(staffPayload({ email_verified: false })), authOpts);
  assert.equal(unverified.status, 401);
});

test('accepts a long server secret and ignores a missing, short, or wrong one', () => {
  const secret = 'correct-horse-battery';
  assert.equal(serviceSecretOk('correct-horse-battery', secret), true);
  assert.equal(serviceSecretOk('correct-horse-batterX', secret), false);
  assert.equal(serviceSecretOk('correct-horse-battery-extra', secret), false);
  assert.equal(serviceSecretOk('', secret), false);
  assert.equal(serviceSecretOk('pianoman', 'pianoman'), false);
  assert.equal(serviceSecretOk('anything', ''), false);
});

test('authorizeDataRequest prefers the secret header and otherwise verifies the bearer token', async () => {
  const secret = 'correct-horse-battery';
  const viaSecret = await authorizeDataRequest(req({ [DATA_KEY_HEADER]: secret }), { secret, ...authOpts });
  assert.equal(viaSecret.ok, true);
  assert.equal(viaSecret.via, 'secret');

  const token = makeToken(staffPayload());
  const viaGoogle = await authorizeDataRequest(req({ authorization: 'Bearer ' + token }), authOpts);
  assert.equal(viaGoogle.ok, true);
  assert.equal(viaGoogle.email, 'lisa@brighamlarsonpianos.com');

  const viaHeader = await authorizeDataRequest(req({ 'x-blp-idtoken': token }), authOpts);
  assert.equal(viaHeader.ok, true);

  const anon = await authorizeDataRequest(req(), authOpts);
  assert.equal(anon.status, 401);
  assert.equal(anon.error, SIGN_IN_ERROR);
});

test('refreshes Google certs once when the token key id is new', async () => {
  __resetCertCacheForTests();
  const token = makeToken(staffPayload());
  let calls = 0;
  const fetchCerts = async () => {
    calls += 1;
    const keys = calls === 1 ? [{ kid: 'old', n: jwk.n, e: jwk.e }] : CERTS;
    return {
      ok: true,
      headers: { get: () => 'max-age=3600' },
      json: async () => ({ keys }),
    };
  };
  const out = await authorizeDataRequest(req({ authorization: 'Bearer ' + token }), {
    clientId: CLIENT,
    now: NOW,
    fetchCerts,
  });
  assert.equal(out.ok, true);
  assert.equal(calls, 2);
  __resetCertCacheForTests();
});

test('fetchGoogleCerts failure is 503 with no customer data', async () => {
  __resetCertCacheForTests();
  const out = await authorizeDataRequest(req({ authorization: 'Bearer abc.def.ghi' }), {
    fetchCerts: async () => { throw new Error('network'); },
  });
  assert.equal(out.status, 503);
  const res = denyResponse(out);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  __resetCertCacheForTests();
});

test('/api/data and /api/top10 return 401/403 with no piano data and no wildcard CORS', async () => {
  let loaded = 0;
  const loadPianos = async () => {
    loaded += 1;
    return { pianos: [{ owner: 'Ada Lovelace', phone: '555-0100', email: 'ada@example.com', address: '1 Secret St' }], source: 'test', lastSync: null };
  };
  const anon = await handleData(req(), { loadPianos });
  assert.equal(anon.status, 401);
  const anonBody = await anon.json();
  assert.deepEqual(Object.keys(anonBody), ['error']);
  assert.equal(JSON.stringify(anonBody).includes('Ada'), false);
  assert.equal(anon.headers.get('access-control-allow-origin'), null);
  assert.equal(loaded, 0);

  const gmail = makeToken(staffPayload({ email: 'tech.blp@gmail.com', hd: '' }));
  const denied = await handleData(req({ authorization: 'Bearer ' + gmail }), { loadPianos, authOpts });
  assert.equal(denied.status, 403);
  const deniedBody = await denied.json();
  assert.equal(deniedBody.pianos, undefined);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(loaded, 0);

  const top = await handleTop10(req({}, 'https://blpstoremap.netlify.app/api/top10'));
  assert.equal(top.status, 401);
  const topBody = await top.json();
  assert.equal(topBody.shop, undefined);
  assert.equal(top.headers.get('access-control-allow-origin'), null);
});

test('a valid Workspace token or the server secret receives piano data, still without CORS *', async () => {
  const loadPianos = async () => ({
    pianos: [{ serial: '181349', owner: 'Ada', active: true, tasks: {} }],
    source: 'test',
    lastSync: null,
  });
  const deps = {
    loadPianos,
    fetchComing: async () => [],
    calendars: async () => ({ events: [], tunings: { upcoming: [], past: [] } }),
    authOpts,
  };
  const token = makeToken(staffPayload());
  const ok = await handleData(req({ authorization: 'Bearer ' + token }), deps);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.pianos[0].serial, '181349');
  assert.equal(ok.headers.get('access-control-allow-origin'), null);

  const secret = 'correct-horse-battery';
  const viaKey = await handleData(req({ [DATA_KEY_HEADER]: secret }), { ...deps, authOpts: { ...authOpts, secret } });
  assert.equal(viaKey.status, 200);
  assert.equal((await viaKey.json()).pianos.length, 1);
  assert.equal(viaKey.headers.get('access-control-allow-origin'), null);

  const topOk = await handleTop10(
    req({ authorization: 'Bearer ' + token }, 'https://blpstoremap.netlify.app/api/top10'),
    { authOpts, load: async () => ({ shop: [{ rank: 1, title: 'Waiting' }], sales: [], admin: [] }) },
  );
  assert.equal(topOk.status, 200);
  assert.equal((await topOk.json()).shop[0].title, 'Waiting');
  assert.equal(topOk.headers.get('access-control-allow-origin'), null);
});

test('the built-in audience matches the public client id the map already uses', () => {
  assert.equal(DEFAULT_GOOGLE_CLIENT_ID, '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com');
});
