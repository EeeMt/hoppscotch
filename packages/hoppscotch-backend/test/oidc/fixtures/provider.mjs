import http from 'node:http';
import https from 'node:https';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';

/** Local-only OIDC test server. Controls are programmatic, never production routes. */
export async function startProvider({
  tls,
  hostname = '127.0.0.1',
  issuerPath = '/application/o/test/',
} = {}) {
  const controls = {
    claims: {
      sub: 'fixture-user',
      email: 'user@internal.example',
      email_verified: false,
      name: 'Fixture User',
    },
    userInfo: {},
    tokenClaims: {},
    omitIdToken: false,
    rejectAuthorization: false,
    rejectToken: false,
    httpErrors: {},
    delay: {},
    metadata: {},
    invalidSignature: false,
  };
  const counts = { discovery: 0, authorize: 0, token: 0, jwks: 0, userinfo: 0 };
  const codes = new Map();
  let keys;
  let issuer;
  function rotateKeys() {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    keys = { ...pair, kid: randomBytes(8).toString('hex') };
  }
  rotateKeys();
  const json = (res, status, value) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(value));
  };
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, issuer);
      let route;
      if (url.pathname.endsWith('/.well-known/openid-configuration'))
        route = 'discovery';
      else route = url.pathname.split('/').filter(Boolean).at(-1);
      if (!(route in counts)) return json(res, 404, { error: 'not_found' });
      counts[route]++;
      if (controls.delay[route])
        await new Promise((resolve) =>
          setTimeout(resolve, controls.delay[route]),
        );
      if (res.destroyed) return;
      if (controls.httpErrors[route])
        return json(res, controls.httpErrors[route], {
          error: 'synthetic_provider_failure',
        });
      if (route === 'discovery')
        return json(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}authorize`,
          token_endpoint: `${issuer}token`,
          jwks_uri: `${issuer}jwks`,
          userinfo_endpoint: `${issuer}userinfo`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: [
            'client_secret_basic',
            'client_secret_post',
          ],
          code_challenge_methods_supported: ['S256'],
          ...controls.metadata,
        });
      if (route === 'jwks')
        return json(res, 200, {
          keys: [
            {
              ...keys.publicKey.export({ format: 'jwk' }),
              kid: keys.kid,
              alg: 'RS256',
              use: 'sig',
            },
          ],
        });
      if (route === 'authorize') {
        const p = url.searchParams;
        if (
          p.get('client_id') !== 'fixture-client' ||
          p.get('response_type') !== 'code' ||
          p.get('code_challenge_method') !== 'S256' ||
          !p.get('code_challenge') ||
          !p.get('nonce')
        )
          return json(res, 400, { error: 'invalid_request' });
        // Never redirect a fixture client to arbitrary external hosts.
        const callback = new URL(p.get('redirect_uri'));
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(callback.hostname))
          return json(res, 400, { error: 'invalid_redirect_uri' });
        callback.searchParams.set('state', p.get('state'));
        if (controls.rejectAuthorization)
          callback.searchParams.set('error', 'access_denied');
        else {
          const code = randomBytes(32).toString('base64url');
          codes.set(code, {
            nonce: p.get('nonce'),
            challenge: p.get('code_challenge'),
            redirectUri: p.get('redirect_uri'),
          });
          callback.searchParams.set('code', code);
        }
        res.writeHead(302, { location: callback.href });
        return res.end();
      }
      if (route === 'token') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const p = new URLSearchParams(Buffer.concat(chunks).toString());
        const authorization = req.headers.authorization;
        const basic =
          authorization?.startsWith('Basic ') &&
          Buffer.from(authorization.slice(6), 'base64')
            .toString()
            .split(':')
            .map((v) => decodeURIComponent(v.replace(/\+/g, ' ')))
            .join(':') === 'fixture-client:fixture-secret';
        const post =
          p.get('client_id') === 'fixture-client' &&
          p.get('client_secret') === 'fixture-secret';
        if (!basic && !post) return json(res, 401, { error: 'invalid_client' });
        const ctx = codes.get(p.get('code'));
        codes.delete(p.get('code'));
        if (
          !ctx ||
          controls.rejectToken ||
          p.get('grant_type') !== 'authorization_code' ||
          p.get('redirect_uri') !== ctx.redirectUri ||
          createHash('sha256')
            .update(p.get('code_verifier') ?? '')
            .digest('base64url') !== ctx.challenge
        )
          return json(res, 400, { error: 'invalid_grant' });
        const now = Math.floor(Date.now() / 1000);
        const payload = {
          ...controls.claims,
          iss: issuer,
          aud: 'fixture-client',
          iat: now,
          exp: now + 300,
          nonce: ctx.nonce,
          ...controls.tokenClaims,
        };
        const header = Buffer.from(
          JSON.stringify({ alg: 'RS256', kid: keys.kid }),
        ).toString('base64url');
        const input = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
        const signingKey = controls.invalidSignature
          ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
          : keys.privateKey;
        const idToken = `${input}.${sign('RSA-SHA256', Buffer.from(input), signingKey).toString('base64url')}`;
        return json(res, 200, {
          access_token: 'fixture-access',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'openid profile email',
          ...(!controls.omitIdToken ? { id_token: idToken } : {}),
        });
      }
      if (route === 'userinfo') {
        if (req.headers.authorization !== 'Bearer fixture-access')
          return json(res, 401, { error: 'invalid_token' });
        return json(res, 200, { ...controls.claims, ...controls.userInfo });
      }
    } catch {
      if (!res.headersSent) json(res, 400, { error: 'invalid_request' });
      else res.end();
    }
  };
  const server = tls
    ? https.createServer(tls, handler)
    : http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, hostname, resolve);
  });
  issuer = `${tls ? 'https' : 'http'}://${hostname}:${server.address().port}${issuerPath}`;
  return {
    issuer,
    discoveryUrl: `${issuer}.well-known/openid-configuration`,
    controls,
    counts,
    rotateKeys,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
