import { OIDCIdentityService } from 'src/auth/oidc/oidc-identity.service';
import { OIDCAccountLinkingService } from 'src/auth/oidc/oidc-account-linking.service';
import { AuthService } from 'src/auth/auth.service';
import { GoogleStrategy } from 'src/auth/strategies/google.strategy';
import { PrismaService } from 'src/prisma/prisma.service';
import { createOIDCApplication } from './support/application';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('legacy/OIDC first-login database isolation', () => {
  let f: Awaited<ReturnType<typeof createOIDCApplication>>;
  let other: PrismaService;
  beforeAll(async () => {
    f = await createOIDCApplication();
    other = new PrismaService();
    await other.onModuleInit();
    for (const [key, value] of Object.entries({
      GOOGLE_CLIENT_ID: 'fixture',
      GOOGLE_CLIENT_SECRET: 'fixture',
      GOOGLE_SCOPE: 'email,profile',
      GOOGLE_CALLBACK_URL: 'http://localhost/callback',
      SESSION_SECRET: 'fixture',
    }))
      f.config.set('INFRA.' + key, value);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await other?.onModuleDestroy();
    await f?.close();
  });

  async function settleOrWaitForLock(isSettled: () => boolean) {
    for (let i = 0; i < 100; i++) {
      if (isSettled()) return;
      const [row] = await f.prisma.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.datname=current_database()) AS waiting`;
      if (row.waiting) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(
      'Login neither settled nor waited on the shared email lock',
    );
  }

  function legacyLogin(kind: string, email: string) {
    const auth = f.app.get(AuthService);
    if (kind === 'magic')
      return auth.signInMagicLink(email, 'app').then((result) => {
        if (result._tag === 'Left') throw new Error(result.left.message);
        return result.right;
      });
    const strategy = new GoogleStrategy(auth, f.config);
    return strategy.validate(
      {} as any,
      'fixture-access',
      'fixture-refresh',
      {
        provider: 'google',
        id: 'legacy-' + email,
        emails: [{ value: email }],
        displayName: 'Legacy',
        photos: [{ value: 'local' }],
      } as any,
      jest.fn(),
    );
  }

  it.each(['google', 'magic'])(
    'serializes %s guard/lookup/writes against OIDC first login',
    async (kind) => {
      const email = `guard-race-${kind}@internal.example`;
      const guarded = deferred(),
        release = deferred();
      const original =
        OIDCAccountLinkingService.prototype.assertLegacyLoginAllowed;
      jest
        .spyOn(OIDCAccountLinkingService.prototype, 'assertLegacyLoginAllowed')
        .mockImplementation(async function (...args) {
          await original.apply(this, args);
          guarded.resolve();
          await release.promise;
        });
      const legacy = legacyLogin(kind, email);
      await guarded.promise;
      let settled = false;
      const oidc = new OIDCIdentityService(other)
        .resolve(
          {
            issuer: 'https://race.internal/',
            sub: email,
            email: email.toUpperCase(),
            emailVerified: false,
          },
          'openid',
        )
        .finally(() => {
          settled = true;
        });
      // Attach rejection handlers before waiting on database locks.
      const results = Promise.allSettled([legacy, oidc]);
      try {
        await settleOrWaitForLock(() => settled);
      } finally {
        release.resolve();
      }
      const resolved = await results;
      expect(resolved.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(resolved.filter((x) => x.status === 'rejected')).toHaveLength(1);
      expect(
        await f.prisma.user.count({
          where: { email: { equals: email, mode: 'insensitive' } },
        }),
      ).toBe(1);
      const user = await f.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      expect(
        await f.prisma.account.count({ where: { userId: user.uid } }),
      ).toBe(1);
    },
  );

  it.each(['google', 'magic'])(
    'rejects %s after an in-flight OIDC creation commits, including case-equivalent emails',
    async (kind) => {
      const email = `commit-race-${kind}@internal.example`;
      const created = deferred(),
        release = deferred();
      const transaction = other.$transaction.bind(other);
      jest.spyOn(other, '$transaction').mockImplementation(
        (operation: any) =>
          transaction(async (tx) => {
            const result = await operation(tx);
            created.resolve();
            await release.promise;
            return result;
          }) as any,
      );
      const oidc = new OIDCIdentityService(other).resolve(
        {
          issuer: 'https://race.internal/',
          sub: email,
          email,
          emailVerified: false,
        },
        'openid',
      );
      await created.promise;
      let settled = false;
      const legacy = legacyLogin(kind, email.toUpperCase()).finally(() => {
        settled = true;
      });
      const results = Promise.allSettled([oidc, legacy]);
      try {
        await settleOrWaitForLock(() => settled);
      } finally {
        release.resolve();
      }
      const [oidcResult, legacyResult] = await results;
      expect(oidcResult.status).toBe('fulfilled');
      expect(legacyResult.status).toBe('rejected');
      expect(
        await f.prisma.user.count({
          where: { email: { equals: email, mode: 'insensitive' } },
        }),
      ).toBe(1);
      const user = await f.prisma.user.findFirst({ where: { email } });
      expect(user.emailVerified).toBe(false);
      expect(
        (await f.prisma.account.findMany({ where: { userId: user.uid } })).map(
          (x) => x.provider,
        ),
      ).toEqual(['oidc']);
    },
  );
});
