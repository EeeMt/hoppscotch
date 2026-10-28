import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { startProvider } from '../fixtures/provider.mjs';
const require = createRequire(import.meta.url);
const {
  OIDCClientAdapter,
} = require('../../../dist/src/auth/oidc/oidc-client.adapter.js');
const {
  readOIDCConfiguration,
} = require('../../../dist/src/auth/oidc/oidc-config.js');
const provider = await startProvider({
  tls: {
    key: readFileSync(process.env.OIDC_TEST_KEY),
    cert: readFileSync(process.env.OIDC_TEST_CERT),
  },
});
try {
  const config = readOIDCConfiguration({
    OIDC_ISSUER: provider.issuer,
    OIDC_CLIENT_ID: 'fixture-client',
    OIDC_CLIENT_SECRET: 'fixture-secret',
    VITE_BACKEND_API_URL: 'http://127.0.0.1:3170/v1',
  });
  const context = {
    version: 1,
    issuer: config.issuer,
    clientId: config.clientId,
    callbackUrl: config.callbackUrl,
    returnUrl: 'http://127.0.0.1:3000',
    nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
  };
  const state = randomBytes(32).toString('base64url');
  const adapter = new OIDCClientAdapter();
  const url = await adapter.authorizationUrl(config, context, state);
  const response = await fetch(url, { redirect: 'manual' });
  const claims = await adapter.callback(
    config,
    context,
    new URL(response.headers.get('location')),
    state,
  );
  process.stdout.write(
    JSON.stringify({
      success: claims.sub === 'fixture-user',
      counts: provider.counts,
    }),
  );
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, code: error.message }));
} finally {
  await provider.close();
}
