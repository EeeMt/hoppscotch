import request from 'supertest';
import { createOIDCApplication } from './support/application';

describe('OIDC browser recovery pages', () => {
  let f: Awaited<ReturnType<typeof createOIDCApplication>>;
  const link = (html: string, id: string) =>
    new URL(
      html
        .match(new RegExp(`id="${id}" href="([^"]+)"`))[1]
        .replace(/&amp;/g, '&'),
    );
  const pending = async (target = f.config.get<string>('VITE_ADMIN_URL')) => {
    const begin = await f.agent
      .get('/v1/auth/oidc')
      .query({ redirect_uri: target })
      .expect(302);
    const auth = await fetch(begin.headers.location, { redirect: 'manual' });
    return new URL(auth.headers.get('location'));
  };
  beforeAll(async () => {
    f = await createOIDCApplication();
  });
  afterAll(async () => {
    await f?.close();
  });
  afterEach(async () => {
    await f.call('controls', { httpErrors: {}, tokenClaims: {} });
  });

  it('renders cancellation safely, retains the admin destination and starts a fresh transaction on retry', async () => {
    const callback = await pending();
    callback.searchParams.delete('code');
    callback.searchParams.set('error', 'access_denied');
    callback.searchParams.set(
      'error_description',
      '<script>vendor-private-detail</script>',
    );
    const failure = await f.agent
      .get(callback.pathname + callback.search)
      .set('Accept', 'text/html')
      .expect(401)
      .expect('Content-Type', /text\/html/);
    expect(failure.text).toContain('Unable to sign in');
    expect(failure.text).not.toContain('vendor-private-detail');
    expect(failure.text).not.toContain(callback.searchParams.get('state'));
    expect(failure.headers['cache-control']).toBe('no-store');
    expect(failure.headers['referrer-policy']).toBe('no-referrer');
    expect(failure.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    const retry = link(failure.text, 'oidc-retry');
    expect(retry.origin).toBe('http://127.0.0.1:3170');
    expect(retry.pathname).toBe('/v1/auth/oidc');
    expect(retry.searchParams.get('redirect_uri')).toBe(
      f.config.get('VITE_ADMIN_URL'),
    );
    expect(await f.prisma.oIDCLoginTransaction.count()).toBe(0);
    await f.agent.get(callback.pathname + callback.search).expect(400);
    await f.agent.get(retry.pathname + retry.search).expect(302);
    expect(await f.prisma.oIDCLoginTransaction.count()).toBe(1);
  });

  it('localizes invalid-state errors without reflecting untrusted return URLs, hosts or query strings', async () => {
    const response = await request(f.server)
      .get(
        '/v1/auth/oidc/callback?state=bad&error=access_denied&redirect_uri=https://evil.example',
      )
      .set('Accept', 'text/html')
      .set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
      .set('X-Forwarded-Host', 'evil.example')
      .expect(400);
    expect(response.text).toContain('登录请求已过期或无效');
    expect(response.text).toContain('重新登录');
    expect(response.text).not.toContain('evil.example');
    expect(link(response.text, 'oidc-return-app').href).toBe(
      f.config.get('VITE_BASE_URL') + '/',
    );
    expect(link(response.text, 'oidc-return-admin').href).toBe(
      f.config.get('VITE_ADMIN_URL') + '/',
    );
  });

  it('recovers from token 503 while preserving an existing local session and rejecting replay', async () => {
    expect((await f.login()).status).toBe(302);
    const callback = await pending();
    await f.call('controls', { httpErrors: { token: 503 } });
    const failure = await f.agent
      .get(callback.pathname + callback.search)
      .set('Accept', 'text/html')
      .expect(503);
    expect(failure.text).toContain('temporarily unavailable');
    expect(failure.text).not.toContain('synthetic_provider_failure');
    expect(failure.text).not.toContain('fixture-secret');
    const cookies = failure.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => /^(access_token|refresh_token)=/.test(c))).toBe(
      false,
    );
    const counts = await f.call('counts');
    await f.agent.get('/v1/auth/verify-token').expect(200);
    await f.agent.get('/v1/auth/refresh').expect(200);
    expect(await f.call('counts')).toEqual(counts);
    await f.agent.get(callback.pathname + callback.search).expect(400);
    await f.call('controls', { httpErrors: {} });
    const retry = link(failure.text, 'oidc-retry');
    const begin = await f.agent.get(retry.pathname + retry.search).expect(302);
    const authorized = await fetch(begin.headers.location, {
      redirect: 'manual',
    });
    const next = new URL(authorized.headers.get('location'));
    const success = await f.agent.get(next.pathname + next.search).expect(302);
    expect(success.headers.location).toBe(f.config.get('VITE_ADMIN_URL'));
    expect(await f.prisma.user.count()).toBe(1);
    expect(await f.prisma.account.count()).toBe(1);
  });

  it('explains email conflicts without exposing the address or creating a partial account', async () => {
    await f.call('controls', { tokenClaims: { sub: 'another-subject' } });
    const callback = await pending();
    const response = await f.agent
      .get(callback.pathname + callback.search)
      .set('Accept', 'text/html')
      .expect(409);
    expect(response.text).toContain('original sign-in method');
    expect(response.text).not.toContain('user@internal.example');
    expect(await f.prisma.user.count()).toBe(1);
    expect(await f.prisma.account.count()).toBe(1);
  });

  it('keeps JSON errors for default, wildcard and JSON-preferred API requests', async () => {
    for (const accept of [
      undefined,
      '*/*',
      'application/json',
      'application/json,text/html;q=0.5',
    ]) {
      const req = request(f.server).get(
        '/v1/auth/oidc/callback?state=bad&error=access_denied',
      );
      if (accept) req.set('Accept', accept);
      const response = await req
        .expect(400)
        .expect('Content-Type', /application\/json/);
      expect(response.body.message).toBe('OIDC_INVALID_TRANSACTION');
    }
  });

  it('preserves the admin entry and subpath when discovery fails before a transaction exists', async () => {
    const base = f.config.get('VITE_BACKEND_API_URL');
    f.config.set('VITE_BACKEND_API_URL', 'http://127.0.0.1:3000/backend/v1');
    f.config.set('INFRA.OIDC_DISCOVERY_URL', 'http://127.0.0.1:1/unreachable');
    try {
      const response = await f.agent
        .get('/v1/auth/oidc')
        .query({ redirect_uri: f.config.get('VITE_ADMIN_URL') })
        .set('Accept', 'text/html')
        .expect(503);
      const retry = link(response.text, 'oidc-retry');
      expect(retry.pathname).toBe('/backend/v1/auth/oidc');
      expect(retry.searchParams.get('redirect_uri')).toBe(
        f.config.get('VITE_ADMIN_URL'),
      );
      expect(response.text).not.toContain('unreachable');
    } finally {
      f.config.set('VITE_BACKEND_API_URL', base);
      f.config.set('INFRA.OIDC_DISCOVERY_URL', '');
    }
  });
});
