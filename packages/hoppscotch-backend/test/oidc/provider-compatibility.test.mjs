import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { startProvider } from './fixtures/provider.mjs';
const require = createRequire(import.meta.url);
const {
  OIDCClientAdapter,
} = require('../../dist/src/auth/oidc/oidc-client.adapter.js');
const {
  readOIDCConfiguration,
} = require('../../dist/src/auth/oidc/oidc-config.js');
const random = () => randomBytes(32).toString('base64url');

async function fixture(t, changes = {}) {
  const p = await startProvider();
  t.after(() => p.close());
  const config = readOIDCConfiguration({
    OIDC_ISSUER: p.issuer,
    OIDC_CLIENT_ID: 'fixture-client',
    OIDC_CLIENT_SECRET: 'fixture-secret',
    OIDC_ALLOW_INSECURE_HTTP: 'true',
    VITE_BACKEND_API_URL: 'http://127.0.0.1:3170/v1',
    ...changes,
  });
  const adapter = new OIDCClientAdapter();
  const login = async () => {
    const context = {
      version: 1,
      nonce: random(),
      verifier: random(),
      issuer: config.issuer,
      clientId: config.clientId,
      callbackUrl: config.callbackUrl,
      returnUrl: 'http://127.0.0.1:3000',
    };
    const state = random();
    const url = await adapter.authorizationUrl(config, context, state);
    const response = await fetch(url, { redirect: 'manual' });
    return adapter.callback(
      config,
      context,
      new URL(response.headers.get('location')),
      state,
    );
  };
  return { p, config, adapter, login };
}

test('client_secret_post works without authentication probing', async (t) => {
  const f = await fixture(t, {
    OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_post',
  });
  assert.equal((await f.login()).sub, 'fixture-user');
  assert.equal(f.p.counts.token, 1);
});
test('independent discovery preserves the exact expected issuer', async (t) => {
  const f = await fixture(t);
  f.config.discoveryUrl = f.p.discoveryUrl;
  assert.equal((await f.login()).issuer, f.p.issuer);
});
test('global issuer works through application discovery', async (t) => {
  const f = await fixture(t);
  f.config.discoveryUrl = f.p.discoveryUrl;
  f.config.issuer = new URL(f.p.issuer).origin + '/';
  f.p.controls.metadata.issuer = f.config.issuer;
  f.p.controls.tokenClaims.iss = f.config.issuer;
  assert.equal((await f.login()).issuer, f.config.issuer);
});
test('UserInfo email carries its own verified state', async (t) => {
  const f = await fixture(t);
  f.p.controls.claims = {
    sub: 'fixture-user',
    email: 'original@internal.example',
    email_verified: true,
  };
  f.p.controls.userInfo = {
    sub: 'fixture-user',
    email: 'different@internal.example',
    name: 'User',
    email_verified: undefined,
  };
  const claims = await f.login();
  assert.equal(claims.email, 'different@internal.example');
  assert.equal(claims.emailVerified, false);
});
test('profile only in UserInfo and mismatched subjects', async (t) => {
  const f = await fixture(t);
  f.p.controls.claims = { sub: 'fixture-user' };
  f.p.controls.userInfo = {
    email: 'info@internal.example',
    name: 'User',
    email_verified: false,
  };
  assert.equal((await f.login()).email, 'info@internal.example');
  f.p.controls.userInfo.sub = 'wrong';
  await assert.rejects(f.login, /OIDC_AUTHENTICATION_FAILED/);
});
test('unknown-kid refreshes JWKS after rotation', async (t) => {
  const f = await fixture(t);
  await f.login();
  f.p.rotateKeys();
  // Respect oauth4webapi's 60-second JWKS refresh cooldown.
  const now = Date.now;
  Date.now = () => now() + 61_000;
  try {
    await f.login();
  } finally {
    Date.now = now;
  }
  assert.equal(f.p.counts.jwks, 2);
});
for (const [name, metadata] of [
  ['issuer mismatch', { issuer: 'https://wrong/' }],
  ['HS256 only', { id_token_signing_alg_values_supported: ['HS256'] }],
  ['no S256', { code_challenge_methods_supported: ['plain'] }],
  ['no code response', { response_types_supported: ['token'] }],
  [
    'unsupported client authentication',
    { token_endpoint_auth_methods_supported: ['none'] },
  ],
  ['missing JWKS', { jwks_uri: undefined }],
])
  test(name + ' fails before authorization', async (t) => {
    const f = await fixture(t);
    f.p.controls.metadata = metadata;
    await assert.rejects(f.login, /OIDC_PROVIDER_UNAVAILABLE/);
    assert.equal(f.p.counts.authorize, 0);
  });
test('single request timeout is bounded and cached failure recovers', async (t) => {
  const f = await fixture(t);
  f.p.controls.delay.discovery = 6000;
  await assert.rejects(f.login, /OIDC_PROVIDER_UNAVAILABLE/);
  f.p.controls.delay.discovery = 0;
  await new Promise((resolve) => setTimeout(resolve, 5100));
  assert.equal((await f.login()).sub, 'fixture-user');
});

test('token network timeout remains a controlled unavailable response', async (t) => {
  const f = await fixture(t);
  f.p.controls.delay.token = 6000;
  await assert.rejects(f.login, /OIDC_PROVIDER_UNAVAILABLE/);
});

test('callback retains a fifteen-second total budget across cold discovery and backchannels', async (t) => {
  const f = await fixture(t);
  const ctx = {
    version: 1,
    nonce: random(),
    verifier: random(),
    issuer: f.config.issuer,
    clientId: f.config.clientId,
    callbackUrl: f.config.callbackUrl,
    returnUrl: 'http://127.0.0.1:3000',
  };
  const state = random();
  const url = await f.adapter.authorizationUrl(f.config, ctx, state);
  const response = await fetch(url, { redirect: 'manual' });
  // Expire discovery without changing transaction configuration, then use four bounded requests.
  f.adapter.cache.expires = 0;
  f.p.controls.claims = { sub: 'fixture-user' };
  f.p.controls.userInfo = { email: 'info@internal.example' };
  Object.assign(f.p.controls.delay, {
    discovery: 4000,
    token: 4000,
    jwks: 4000,
    userinfo: 4000,
  });
  const start = Date.now();
  await assert.rejects(
    () =>
      f.adapter.callback(
        f.config,
        ctx,
        new URL(response.headers.get('location')),
        state,
      ),
    /OIDC_PROVIDER_UNAVAILABLE/,
  );
  assert.ok(Date.now() - start < 16_500);
});

for (const endpoint of ['token', 'jwks', 'userinfo']) {
  for (const status of [500, 503]) {
    test(`${endpoint} HTTP ${status} is a controlled availability error and recovers`, async (t) => {
      const f = await fixture(t);
      if (endpoint === 'userinfo')
        f.p.controls.claims = { sub: 'fixture-user' };
      f.p.controls.httpErrors[endpoint] = status;
      await assert.rejects(f.login, (error) => {
        assert.equal(error.getStatus(), 503);
        assert.equal(error.message, 'OIDC_PROVIDER_UNAVAILABLE');
        assert.equal(
          JSON.stringify(error.getResponse()).includes(
            'synthetic_provider_failure',
          ),
          false,
        );
        return true;
      });
      delete f.p.controls.httpErrors[endpoint];
      assert.equal((await f.login()).sub, 'fixture-user');
    });
  }
}
test('HTTP 503 discovery is retried after the failure-cache window', async (t) => {
  const f = await fixture(t);
  f.p.controls.httpErrors.discovery = 503;
  await assert.rejects(
    f.login,
    (error) =>
      error.getStatus() === 503 &&
      error.message === 'OIDC_PROVIDER_UNAVAILABLE',
  );
  delete f.p.controls.httpErrors.discovery;
  const now = Date.now;
  t.after(() => {
    Date.now = now;
  });
  Date.now = () => now() + 5001;
  assert.equal((await f.login()).sub, 'fixture-user');
  assert.equal(f.p.counts.discovery, 2);
});
test('upstream authentication rejection stays a 401', async (t) => {
  const f = await fixture(t);
  f.p.controls.httpErrors.token = 401;
  await assert.rejects(
    f.login,
    (error) =>
      error.getStatus() === 401 &&
      error.message === 'OIDC_AUTHENTICATION_FAILED',
  );
});

test('HTTP remains explicitly scoped and disabled by default', async (t) => {
  const f = await fixture(t);
  assert.throws(() =>
    readOIDCConfiguration({
      OIDC_ISSUER: f.p.issuer,
      OIDC_CLIENT_ID: 'fixture-client',
      OIDC_CLIENT_SECRET: 'fixture-secret',
      VITE_BACKEND_API_URL: 'http://127.0.0.1:3170/v1',
    }),
  );
  assert.equal((await f.login()).sub, 'fixture-user');
});

test('private CA fixture succeeds only with startup trust and a matching hostname', async (t) => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync, execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const directory = mkdtempSync(join(tmpdir(), 'hopp-oidc-tls-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const openssl = (args) =>
    execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
  openssl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca-key.pem',
    '-out',
    'ca.pem',
    '-days',
    '1',
    '-subj',
    '/CN=OIDC Test CA',
  ]);
  openssl([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'server-key.pem',
    '-out',
    'server.csr',
    '-subj',
    '/CN=localhost',
  ]);
  writeFileSync(
    join(directory, 'san.ext'),
    'subjectAltName=DNS:localhost,IP:127.0.0.1\n',
  );
  writeFileSync(
    join(directory, 'mismatch.ext'),
    'subjectAltName=DNS:wrong.internal\n',
  );
  for (const name of ['san', 'mismatch'])
    openssl([
      'x509',
      '-req',
      '-in',
      'server.csr',
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca-key.pem',
      '-CAcreateserial',
      '-out',
      name + '.pem',
      '-days',
      '1',
      '-extfile',
      name + '.ext',
    ]);
  const run = async (trusted, cert = 'san.pem') => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [new URL('./support/tls-protocol.mjs', import.meta.url).pathname],
      {
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: trusted ? join(directory, 'ca.pem') : '',
          OIDC_TEST_KEY: join(directory, 'server-key.pem'),
          OIDC_TEST_CERT: join(directory, cert),
        },
      },
    );
    return JSON.parse(stdout);
  };
  assert.equal((await run(true)).success, true);
  assert.equal((await run(false)).success, false);
  assert.equal((await run(true, 'mismatch.pem')).success, false);
});
