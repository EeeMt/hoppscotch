import { OIDCIdentityService } from './oidc-identity.service';

describe('OIDC profile admission and verification state', () => {
  const tx = {
    $executeRaw: jest.fn(),
    account: { findUnique: jest.fn(), update: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const service = new OIDCIdentityService({
    $transaction: (callback) => callback(tx),
  } as any);
  beforeEach(() => {
    jest.resetAllMocks();
    tx.user.create.mockImplementation(({ data }) => data);
  });
  it.each([false, undefined, 'true', true])(
    'admits legal email with verified=%p',
    async (verified) => {
      const user = await service.resolve(
        {
          issuer: 'https://idp/',
          sub: 'id',
          email: 'User@internal.example',
          emailVerified: verified as any,
        },
        'openid',
      );
      expect(user.email).toBe('user@internal.example');
      expect(user.emailVerified).toBe(verified === true);
      expect(user.isAdmin).toBe(false);
    },
  );
  it('rejects first login without email before writing a user', async () => {
    await expect(
      service.resolve(
        { issuer: 'https://idp/', sub: 'id', emailVerified: false },
        'openid',
      ),
    ).rejects.toThrow('OIDC_EMAIL_REQUIRED');
    expect(tx.user.create).not.toHaveBeenCalled();
  });
  it('allows an existing identity without email and retains the local address/state', async () => {
    tx.account.findUnique.mockResolvedValue({
      userId: 'local',
      user: { email: 'local@internal.example' },
    });
    tx.user.update.mockImplementation(({ data }) => data);
    const result = await service.resolve(
      { issuer: 'https://idp/', sub: 'id', emailVerified: false },
      'openid',
    );
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('emailVerified');
  });
});
