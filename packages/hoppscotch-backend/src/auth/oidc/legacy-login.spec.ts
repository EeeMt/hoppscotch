import { ConfigService } from '@nestjs/config';
import * as O from 'fp-ts/Option';
import { GoogleStrategy } from '../strategies/google.strategy';
import { GithubStrategy } from '../strategies/github.strategy';
import { MicrosoftStrategy } from '../strategies/microsoft.strategy';
import { OIDCAccountLinkingService } from './oidc-account-linking.service';
import { AuthService } from '../auth.service';

describe('legacy provider fixtures (no live supplier credentials)', () => {
  const user = {
    uid: 'legacy',
    email: 'user@internal.example',
    displayName: 'Legacy',
    photoURL: 'local',
  };
  const users = {
    findUserByEmail: jest.fn().mockResolvedValue(O.some(user)),
    createUserSSO: jest.fn(),
    updateUserDetails: jest.fn(),
    createProviderAccount: jest.fn(),
  };
  const db = {
    $executeRaw: jest.fn(),
    $transaction: jest.fn((operation) => operation(db)),
    account: { findFirst: jest.fn(), findUnique: jest.fn() },
  };
  const auth = new AuthService(users as any, db as any, null, null, null, null);
  const config = new ConfigService({
    INFRA: Object.fromEntries(
      ['GOOGLE', 'GITHUB', 'MICROSOFT'].flatMap((provider) =>
        ['CLIENT_ID', 'CLIENT_SECRET', 'SCOPE', 'CALLBACK_URL', 'TENANT'].map(
          (key) => [
            `${provider}_${key}`,
            key === 'CALLBACK_URL' ? 'https://app/callback' : 'fixture',
          ],
        ),
      ),
    ),
  });
  config.set('INFRA.SESSION_SECRET', 'fixture-state-secret');
  const strategies = [
    new GoogleStrategy(auth, config),
    new GithubStrategy(auth, config),
    new MicrosoftStrategy(auth, config),
  ];
  beforeEach(() => {
    jest.clearAllMocks();
    db.account.findFirst.mockResolvedValue(null);
    db.account.findUnique.mockResolvedValue({ userId: 'legacy' });
  });
  it.each([0, 1, 2])(
    'preserves existing supplier association #%i',
    async (index) => {
      const profile = {
        provider: ['google', 'github', 'microsoft'][index],
        id: 'fixture-id',
        emails: [{ value: user.email }],
      };
      const result =
        index === 0
          ? await (strategies[index] as GoogleStrategy).validate(
              {} as any,
              'fixture-access',
              'fixture-refresh',
              profile as any,
              jest.fn(),
            )
          : await (strategies[index] as any).validate(
              'fixture-access',
              'fixture-refresh',
              profile,
              jest.fn(),
            );
      expect(result).toEqual(user);
      expect(users.createProviderAccount).not.toHaveBeenCalled();
      expect(users.findUserByEmail).toHaveBeenCalledWith(user.email, db);
      expect(db.$executeRaw).toHaveBeenCalled();
    },
  );
  it.each([0, 1, 2])(
    'checks the OIDC boundary before any supplier profile writes #%i',
    async (index) => {
      db.account.findFirst.mockResolvedValue({ userId: 'oidc' });
      db.account.findUnique.mockResolvedValue(null);
      const profile = {
        provider: ['google', 'github', 'microsoft'][index],
        id: 'fixture-id',
        emails: [{ value: user.email }],
      };
      const call =
        index === 0
          ? (strategies[index] as GoogleStrategy).validate(
              {} as any,
              'a',
              'r',
              profile as any,
              jest.fn(),
            )
          : (strategies[index] as any).validate('a', 'r', profile, jest.fn());
      await expect(call).rejects.toThrow('OIDC_IDENTITY_EMAIL_CONFLICT');
      expect(users.updateUserDetails).not.toHaveBeenCalled();
    },
  );
  it('magic and supplier first associations cannot enter an OIDC account', async () => {
    const db = {
      account: {
        findFirst: jest.fn().mockResolvedValue({ userId: 'oidc' }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const guard = new OIDCAccountLinkingService(db as any);
    for (const provider of ['google', 'github', 'microsoft', 'magic'])
      await expect(
        guard.assertLegacyLoginAllowed(user.email, provider, 'new'),
      ).rejects.toThrow('OIDC_IDENTITY_EMAIL_CONFLICT');
  });
});
