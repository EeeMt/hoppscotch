import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const {
  OIDCClientAdapter,
} = require('../../../dist/src/auth/oidc/oidc-client.adapter.js');
const {
  readOIDCConfiguration,
} = require('../../../dist/src/auth/oidc/oidc-config.js');
try {
  const c = JSON.parse(
    readFileSync(process.env.OIDC_LIVE_AUTHENTIK_FILE, 'utf8'),
  );
  const config = readOIDCConfiguration({
    OIDC_ISSUER: c.issuer,
    OIDC_DISCOVERY_URL: c.useDiscoveryUrl ? c.discoveryUrl : '',
    OIDC_CLIENT_ID: c.clientId,
    OIDC_CLIENT_SECRET: c.clientSecret,
    OIDC_TOKEN_ENDPOINT_AUTH_METHOD: c.authMethod || 'client_secret_basic',
    OIDC_ALLOW_INSECURE_HTTP:
      process.env.OIDC_FORCE_HTTPS_ONLY === '1'
        ? 'false'
        : String(c.issuer.startsWith('http:')),
    VITE_BACKEND_API_URL: c.apiUrl,
  });
  await new OIDCClientAdapter().authorizationUrl(
    config,
    {
      version: 1,
      issuer: c.issuer,
      clientId: c.clientId,
      callbackUrl: config.callbackUrl,
      returnUrl: c.appUrl,
      nonce: 'discovery-check',
      verifier: 'discovery-check',
    },
    'discovery-check',
  );
  process.stdout.write(JSON.stringify({ success: true }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({ success: false, status: error.getStatus?.() ?? 400 }),
  );
}
