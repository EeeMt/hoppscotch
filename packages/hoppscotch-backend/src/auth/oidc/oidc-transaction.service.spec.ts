import { OIDCTransactionService } from './oidc-transaction.service';
import { createHash } from 'crypto';
import { readOIDCConfiguration } from './oidc-config';

describe('OIDC transaction browser and atomic-delete gate', () => {
  const db = {
    oIDCLoginTransaction: { findFirst: jest.fn(), deleteMany: jest.fn() },
  };
  const service = new OIDCTransactionService(db as any);
  const state = 'a'.repeat(43),
    binding = 'b'.repeat(43);
  const config = readOIDCConfiguration({
    OIDC_ISSUER: 'https://idp/',
    OIDC_CLIENT_ID: 'id',
    OIDC_CLIENT_SECRET: 'secret',
    VITE_BACKEND_API_URL: 'https://hopp/backend/v1',
  });
  const cookie = 'oidc_' + createHash('sha256').update(state).digest('hex');
  const res = { clearCookie: jest.fn() };
  beforeEach(() => jest.resetAllMocks());
  it('cannot delete another browser pending transaction without its binding', async () => {
    await expect(
      service.consume(state, config, { cookies: {} } as any, res as any),
    ).rejects.toThrow('OIDC_INVALID_TRANSACTION');
    expect(db.oIDCLoginTransaction.deleteMany).not.toHaveBeenCalled();
  });
  it('requires exactly one conditional deletion before decrypting context', async () => {
    db.oIDCLoginTransaction.findFirst.mockResolvedValue({
      encryptedContext: 'not-decryptable',
    });
    db.oIDCLoginTransaction.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      service.consume(
        state,
        config,
        { cookies: { [cookie]: binding } } as any,
        res as any,
      ),
    ).rejects.toThrow('OIDC_INVALID_TRANSACTION');
    expect(db.oIDCLoginTransaction.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        configFingerprint: config.fingerprint,
        browserBindingHash: createHash('sha256').update(binding).digest('hex'),
        expiresAt: { gt: expect.any(Date) },
      }),
    });
  });
});
