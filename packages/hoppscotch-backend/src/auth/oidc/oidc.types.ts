export interface OIDCConfiguration {
  issuer: string;
  discoveryUrl?: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scope: string;
  authMethod: 'client_secret_basic' | 'client_secret_post';
  allowInsecureHttp: boolean;
  fingerprint: string;
}

export interface OIDCContext {
  version: 1;
  nonce: string;
  verifier: string;
  issuer: string;
  clientId: string;
  callbackUrl: string;
  returnUrl: string;
}

/** Only the protocol adapter may construct these after signature/subject validation. */
export interface OIDCVerifiedClaims {
  issuer: string;
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  preferredUsername?: string;
}

export interface OIDCClient {
  authorizationUrl(
    config: OIDCConfiguration,
    context: OIDCContext,
    state: string,
  ): Promise<URL>;
  callback(
    config: OIDCConfiguration,
    context: OIDCContext,
    url: URL,
    state: string,
  ): Promise<OIDCVerifiedClaims>;
}
