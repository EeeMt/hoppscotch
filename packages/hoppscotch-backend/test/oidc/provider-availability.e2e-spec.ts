import request from 'supertest';
import { createOIDCApplication } from './support/application';

describe('upstream HTTP availability failures', () => {
  let f: Awaited<ReturnType<typeof createOIDCApplication>>;
  beforeAll(async () => {
    f = await createOIDCApplication();
  });
  afterAll(async () => {
    await f?.close();
  });
  it('returns a safe 503 without creating users/tokens or disturbing an existing local session, then recovers', async () => {
    expect((await f.login()).status).toBe(302);
    await f.call('controls', { httpErrors: { token: 503 } });
    const second = request.agent(f.server);
    const failure = await f.login(second);
    expect(failure.status).toBe(503);
    expect(failure.body.message).toBe('OIDC_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(failure.body)).not.toContain(
      'synthetic_provider_failure',
    );
    const cookies = failure.headers['set-cookie'];
    const cookieHeaders = Array.isArray(cookies)
      ? cookies
      : cookies
        ? [cookies]
        : [];
    expect(
      cookieHeaders.some((value: string) =>
        /^(access_token|refresh_token)=/.test(value),
      ),
    ).toBe(false);
    expect(await f.prisma.user.count()).toBe(1);
    expect(await f.prisma.account.count()).toBe(1);
    const before = await f.call('counts');
    await f.agent.get('/v1/auth/verify-token').expect(200);
    await f.agent.get('/v1/auth/refresh').expect(200);
    expect(await f.call('counts')).toEqual(before);
    await f.call('controls', { httpErrors: {} });
    expect((await f.login(second)).status).toBe(302);
    expect(await f.prisma.user.count()).toBe(1);
    expect(await f.prisma.account.count()).toBe(1);
  });
});
