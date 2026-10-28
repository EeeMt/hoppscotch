import request from 'supertest';
import { createOIDCApplication } from './support/application';

describe('OIDC-only onboarding without SMTP', () => {
  let f: Awaited<ReturnType<typeof createOIDCApplication>>;
  beforeAll(async () => {
    f = await createOIDCApplication();
  });
  afterAll(async () => {
    await f?.close();
  });
  it('applies omitted OIDC defaults through the production DTO transformation', async () => {
    await f.prisma.infraConfig.update({
      where: { name: 'OIDC_ALLOW_INSECURE_HTTP' },
      data: { value: 'false' },
    });
    const before = await f.call('counts');
    await request(f.server)
      .post('/v1/onboarding/config')
      .send({
        VITE_ALLOWED_AUTH_PROVIDERS: 'OIDC',
        OIDC_ISSUER: 'https://sso.internal/application/o/minimal/',
        OIDC_CLIENT_ID: 'minimal-client',
        OIDC_CLIENT_SECRET: 'minimal-secret',
        MAILER_SMTP_ENABLE: 'false',
      })
      .expect(201);
    const rows = await f.prisma.infraConfig.findMany({
      where: {
        name: {
          in: [
            'OIDC_SCOPE',
            'OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
            'OIDC_ALLOW_INSECURE_HTTP',
          ],
        },
      },
    });
    expect(
      Object.fromEntries(rows.map((row) => [row.name, row.value])),
    ).toEqual({
      OIDC_SCOPE: 'openid,profile,email',
      OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_basic',
      OIDC_ALLOW_INSECURE_HTTP: 'false',
    });
    expect(await f.call('counts')).toEqual(before);
  });
  it.each([
    'OIDC_SCOPE',
    'OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
    'OIDC_ALLOW_INSECURE_HTTP',
  ])(
    'rejects explicitly empty %s rather than applying an omitted-value default',
    async (key) => {
      const before = await f.prisma.infraConfig.findMany({
        orderBy: { name: 'asc' },
      });
      await request(f.server)
        .post('/v1/onboarding/config')
        .send({
          VITE_ALLOWED_AUTH_PROVIDERS: 'OIDC',
          OIDC_ISSUER: 'https://sso.internal/application/o/minimal/',
          OIDC_CLIENT_ID: 'client',
          OIDC_CLIENT_SECRET: 'secret',
          MAILER_SMTP_ENABLE: 'false',
          [key]: '',
        })
        .expect(400);
      expect(
        await f.prisma.infraConfig.findMany({ orderBy: { name: 'asc' } }),
      ).toEqual(before);
    },
  );
  it('saves OIDC alone with empty mailer fields and encrypts the client secret', async () => {
    const infra = f.config.get('INFRA');
    await request(f.server)
      .post('/v1/onboarding/config')
      .send({
        VITE_ALLOWED_AUTH_PROVIDERS: 'OIDC',
        OIDC_ISSUER: infra.OIDC_ISSUER,
        OIDC_CLIENT_ID: infra.OIDC_CLIENT_ID,
        OIDC_CLIENT_SECRET: infra.OIDC_CLIENT_SECRET,
        OIDC_ALLOW_INSECURE_HTTP: 'true',
        MAILER_SMTP_ENABLE: 'false',
        MAILER_SMTP_URL: '',
        MAILER_ADDRESS_FROM: '',
        MAILER_SMTP_HOST: '',
        MAILER_SMTP_PORT: '',
      })
      .expect(201);
    const stored = await f.prisma.infraConfig.findUnique({
      where: { name: 'OIDC_CLIENT_SECRET' },
    });
    expect(stored.isEncrypted).toBe(true);
    expect(stored.value).not.toBe(infra.OIDC_CLIENT_SECRET);
    expect(
      (
        await f.prisma.infraConfig.findUnique({
          where: { name: 'MAILER_SMTP_ENABLE' },
        })
      ).value,
    ).toBe('false');
  });
  it('keeps first-admin bootstrap and second-user privileges independent of verified', async () => {
    expect((await f.login()).status).toBe(302);
    await f.agent.get('/v1/auth/verify/admin').expect(200, { isAdmin: true });
    const counts = await f.call('counts');
    await f.agent.get('/v1/auth/refresh').expect(200);
    expect(await f.call('counts')).toEqual(counts);
    await f.call('controls', {
      claims: {
        sub: 'second',
        email: 'second@internal.example',
        name: 'Second',
      },
    });
    const second = request.agent(f.server);
    expect((await f.login(second)).status).toBe(302);
    await second.get('/v1/auth/verify/admin').expect(200, { isAdmin: false });
    expect(await f.prisma.user.count({ where: { isAdmin: true } })).toBe(1);
    expect(await f.prisma.user.count({ where: { emailVerified: false } })).toBe(
      2,
    );
    expect(f.mailer.sendEmail).not.toHaveBeenCalled();
    await second.get('/v1/auth/logout').expect(200);
  });
});
