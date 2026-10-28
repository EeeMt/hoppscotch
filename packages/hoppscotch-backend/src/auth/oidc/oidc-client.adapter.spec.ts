import { OIDCClientAdapter } from './oidc-client.adapter';
import { readOIDCConfiguration } from './oidc-config';

describe('lazy discovery and recovery', () => {
  const config = readOIDCConfiguration({
    OIDC_ISSUER: 'https://idp.internal/app/',
    OIDC_CLIENT_ID: 'client',
    OIDC_CLIENT_SECRET: 'secret',
    VITE_BACKEND_API_URL: 'https://app.internal/backend/v1',
  });
  const metadata = {
    issuer: config.issuer,
    authorization_endpoint: 'https://idp.internal/auth',
    token_endpoint: 'https://idp.internal/token',
    jwks_uri: 'https://idp.internal/keys',
    id_token_signing_alg_values_supported: ['RS256'],
    response_types_supported: ['code'],
  };
  const context = {
    version: 1 as const,
    nonce: 'nonce',
    verifier: 'verifier',
    issuer: config.issuer,
    clientId: config.clientId,
    callbackUrl: config.callbackUrl,
    returnUrl: 'https://app.internal',
  };
  let service: OIDCClientAdapter;
  let discovery: jest.Mock;
  beforeEach(() => {
    service = new OIDCClientAdapter();
    discovery = jest.fn().mockResolvedValue({ serverMetadata: () => metadata });
    (service as any).library = () => ({
      discovery,
      ClientSecretBasic: jest.fn(),
      enableNonRepudiationChecks: jest.fn(),
      customFetch: Symbol.for('fetch'),
      buildAuthorizationUrl: () => new URL(metadata.authorization_endpoint),
    });
  });
  afterEach(() => jest.restoreAllMocks());
  it('does no discovery until requested, merges concurrent calls and caches for fifteen minutes', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    expect(discovery).not.toHaveBeenCalled();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        service.authorizationUrl(config, context, 'state'),
      ),
    );
    expect(discovery).toHaveBeenCalledTimes(1);
    now = 899999;
    await service.authorizationUrl(config, context, 'state');
    expect(discovery).toHaveBeenCalledTimes(1);
    now = 900001;
    await service.authorizationUrl(config, context, 'state');
    expect(discovery).toHaveBeenCalledTimes(2);
  });
  it('retries failures after five seconds without restarting', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    discovery.mockRejectedValueOnce(new Error('offline'));
    await expect(
      service.authorizationUrl(config, context, 's'),
    ).rejects.toThrow('OIDC_PROVIDER_UNAVAILABLE');
    now = 4999;
    await expect(
      service.authorizationUrl(config, context, 's'),
    ).rejects.toThrow();
    expect(discovery).toHaveBeenCalledTimes(1);
    now = 5001;
    await service.authorizationUrl(config, context, 's');
    expect(discovery).toHaveBeenCalledTimes(2);
  });
  it('rejects a different issuer including a missing trailing slash', async () => {
    discovery.mockResolvedValue({
      serverMetadata: () => ({
        ...metadata,
        issuer: config.issuer.slice(0, -1),
      }),
    });
    await expect(
      service.authorizationUrl(config, context, 's'),
    ).rejects.toThrow('OIDC_PROVIDER_UNAVAILABLE');
  });
});
