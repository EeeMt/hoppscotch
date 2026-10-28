import { OIDCIdentityService } from 'src/auth/oidc/oidc-identity.service';
import { OIDCAccountLinkingService } from 'src/auth/oidc/oidc-account-linking.service';
import { createOIDCApplication } from './support/application';

describe('OIDC database identity concurrency', () => {
  let f: Awaited<ReturnType<typeof createOIDCApplication>>;
  let identity: OIDCIdentityService;
  const claims = {
    issuer: 'https://idp.internal/app/',
    sub: 'concurrent',
    email: 'Concurrent@internal.example',
    emailVerified: false,
  };
  beforeAll(async () => {
    f = await createOIDCApplication();
    identity = f.app.get(OIDCIdentityService);
  });
  afterAll(async () => {
    await f?.close();
  });
  it('same identity creates exactly one account under concurrent first login', async () => {
    const users = await Promise.all(
      Array.from({ length: 8 }, () => identity.resolve(claims, 'openid')),
    );
    expect(new Set(users.map((u) => u.uid)).size).toBe(1);
    expect(await f.prisma.user.count()).toBe(1);
    expect(await f.prisma.account.count()).toBe(1);
  });
  it('different identities racing for case-equivalent emails cannot merge', async () => {
    const results = await Promise.allSettled(
      ['A', 'B'].map((sub, i) =>
        identity.resolve(
          {
            ...claims,
            sub,
            email: i ? 'RACE@internal.example' : 'race@internal.example',
          },
          'openid',
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await f.prisma.user.count()).toBe(2);
  });
  it('same subject with different issuer cannot take over an existing email', async () => {
    await expect(
      identity.resolve(
        { ...claims, issuer: 'https://different.internal/' },
        'openid',
      ),
    ).rejects.toThrow('OIDC_IDENTITY_EMAIL_CONFLICT');
    const existing = await identity.resolve(
      { ...claims, email: undefined },
      'openid',
    );
    expect(existing.email).toBe('concurrent@internal.example');
    expect(
      (
        await identity.resolve(
          { ...claims, email: 'changed@internal.example', emailVerified: true },
          'openid',
        )
      ).emailVerified,
    ).toBe(false);
  });
  it('legacy providers cannot reverse-link an OIDC account via email', async () => {
    const guard = new OIDCAccountLinkingService(f.prisma);
    for (const provider of ['google', 'github', 'microsoft', 'magic'])
      await expect(
        guard.assertLegacyLoginAllowed(claims.email, provider, 'new'),
      ).rejects.toThrow('OIDC_IDENTITY_EMAIL_CONFLICT');
    expect(await f.prisma.account.count()).toBe(2);
  });
});
