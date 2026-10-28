import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createOIDCApplication } from './support/application';

describe('OIDC real routes and isolated database', () => {
  let fixture: Awaited<ReturnType<typeof createOIDCApplication>>;
  beforeAll(async () => {
    fixture = await createOIDCApplication();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  it('publishes only the provider identifier and rejects arbitrary return URLs', async () => {
    await request(fixture.server)
      .get('/v1/auth/providers')
      .expect(200, { providers: ['OIDC'] });
    await request(fixture.server)
      .get('/v1/auth/oidc')
      .query({ redirect_uri: 'https://evil.example/' })
      .expect(400);
    expect((await fixture.call('counts')).discovery).toBe(0);
  });
  it('creates a non-admin unverified account, issues local cookies, and updates the existing identity', async () => {
    const response = await fixture.login();
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('http://127.0.0.1:3000');
    expect(
      (response.headers['set-cookie'] as unknown as string[]).some((c) =>
        c.startsWith('access_token='),
      ),
    ).toBe(true);
    const user = await fixture.prisma.user.findFirst();
    expect(user.emailVerified).toBe(false);
    expect(user.isAdmin).toBe(false);
    const account = await fixture.prisma.account.findFirst();
    expect(account.provider).toBe('oidc');
    expect(account.providerAccessToken).toBeNull();
    expect(account.providerRefreshToken).toBeNull();
    expect((await fixture.login()).status).toBe(302);
    expect(await fixture.prisma.user.count()).toBe(1);
    expect(fixture.mailer.sendEmail).not.toHaveBeenCalled();
  });
  it('the actual admin Me query preserves false and true verification states', async () => {
    const source = readFileSync(
      join(
        __dirname,
        '../../../hoppscotch-sh-admin/src/helpers/backend/rest/authQuery.ts',
      ),
      'utf8',
    );
    const query = source.match(/query: `([^`]+)`/)[1];
    expect(query).toContain('emailVerified');
    const first = await fixture.agent
      .post('/graphql')
      .send({ query })
      .expect(200);
    expect(first.body.data.me.emailVerified).toBe(false);
    await fixture.call('controls', {
      claims: {
        sub: 'fixture-user',
        email: 'user@internal.example',
        email_verified: true,
        name: 'Fixture User',
      },
    });
    expect((await fixture.login()).status).toBe(302);
    const second = await fixture.agent
      .post('/graphql')
      .send({ query })
      .expect(200);
    expect(second.body.data.me.emailVerified).toBe(true);
  });
  it('rejects a different identity with the same email without partial writes', async () => {
    await fixture.call('controls', { tokenClaims: { sub: 'different-user' } });
    expect((await fixture.login(request.agent(fixture.server))).status).toBe(
      409,
    );
    expect(await fixture.prisma.user.count()).toBe(1);
    expect(await fixture.prisma.account.count()).toBe(1);
  });
});
