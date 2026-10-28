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

async function flow(t, change = {}, configure = () => {}) {
  const provider = await startProvider();
  t.after(() => provider.close());
  configure(provider);
  const config = readOIDCConfiguration({
    OIDC_ISSUER: provider.issuer,
    OIDC_CLIENT_ID: 'fixture-client',
    OIDC_CLIENT_SECRET: 'fixture-secret',
    OIDC_ALLOW_INSECURE_HTTP: 'true',
    VITE_BACKEND_API_URL: 'http://127.0.0.1:3170/v1',
    ...change,
  });
  const adapter = new OIDCClientAdapter();
  const context = {
    version: 1,
    issuer: config.issuer,
    clientId: config.clientId,
    callbackUrl: config.callbackUrl,
    returnUrl: 'http://127.0.0.1:3000',
    nonce: random(),
    verifier: random(),
  };
  const state = random();
  const authorize = await adapter.authorizationUrl(config, context, state);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.has('code_verifier'), false);
  const response = await fetch(authorize, { redirect: 'manual' });
  const callback = new URL(response.headers.get('location'));
  return { provider, adapter, config, context, state, callback };
}

test('CommonJS adapter loads real openid-client and completes signed PKCE login', async (t) => {
  const f = await flow(t);
  const claims = await f.adapter.callback(
    f.config,
    f.context,
    f.callback,
    f.state,
  );
  assert.equal(claims.sub, 'fixture-user');
  assert.equal(claims.emailVerified, false);
  assert.equal(f.provider.counts.jwks, 1);
  assert.equal(f.provider.counts.userinfo, 0);
});

for (const [name, controls] of [
  [
    'missing verified',
    {
      claims: {
        sub: 'fixture-user',
        email: 'user@internal.example',
        name: 'User',
      },
    },
  ],
  [
    'string verified',
    {
      claims: {
        sub: 'fixture-user',
        email: 'user@internal.example',
        name: 'User',
        email_verified: 'true',
      },
    },
  ],
])
  test(name + ' does not block authentication or become true', async (t) => {
    const f = await flow(t, {}, (p) => Object.assign(p.controls, controls));
    assert.equal(
      (await f.adapter.callback(f.config, f.context, f.callback, f.state))
        .emailVerified,
      false,
    );
  });

for (const [name, controls] of [
  ['wrong signature', { invalidSignature: true }],
  ['missing ID token', { omitIdToken: true }],
  ['wrong issuer', { tokenClaims: { iss: 'https://other.internal/' } }],
  ['wrong audience', { tokenClaims: { aud: 'other-client' } }],
  ['expired token', { tokenClaims: { exp: 1 } }],
  ['wrong nonce', { tokenClaims: { nonce: 'wrong' } }],
  ['empty subject', { tokenClaims: { sub: '' } }],
  ['missing nonce', { tokenClaims: { nonce: undefined } }],
  [
    'future issued token',
    { tokenClaims: { iat: Math.floor(Date.now() / 1000) + 3600 } },
  ],
  [
    'future nbf',
    { tokenClaims: { nbf: Math.floor(Date.now() / 1000) + 3600 } },
  ],
  [
    'wrong authorized party',
    { tokenClaims: { aud: ['fixture-client', 'another'], azp: 'another' } },
  ],
  ['token rejection', { rejectToken: true }],
])
  test(name + ' is rejected by real protocol processing', async (t) => {
    const f = await flow(t, {}, (p) => Object.assign(p.controls, controls));
    await assert.rejects(
      () => f.adapter.callback(f.config, f.context, f.callback, f.state),
      /OIDC_AUTHENTICATION_FAILED/,
    );
  });

test('wrong state and wrong PKCE verifier are rejected', async (t) => {
  const f = await flow(t);
  await assert.rejects(() =>
    f.adapter.callback(f.config, f.context, f.callback, random()),
  );
  await assert.rejects(() =>
    f.adapter.callback(
      f.config,
      { ...f.context, verifier: random() },
      f.callback,
      f.state,
    ),
  );
});
