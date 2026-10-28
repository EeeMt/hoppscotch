import {
  OIDC_PROVIDER_UNAVAILABLE,
  OIDC_AUTHENTICATION_FAILED,
} from '../../errors';
import { selectOIDCClaims } from './oidc-claims';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';
import {
  OIDCClient,
  OIDCConfiguration,
  OIDCContext,
  OIDCVerifiedClaims,
} from './oidc.types';
import { validateOIDCUrl } from './oidc-config';

type Library = typeof import('openid-client');
type Configuration = import('openid-client').Configuration;

@Injectable()
export class OIDCClientAdapter implements OIDCClient {
  private cache?: {
    fingerprint: string;
    expires: number;
    value?: Configuration;
    pending?: Promise<Configuration>;
    failed?: boolean;
  };
  private readonly deadline = new AsyncLocalStorage<number>();
  private library(): Library {
    // Deliberate lazy require(esm): keep the backend CommonJS and discovery off startup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('openid-client');
  }

  private async configuration(
    input: OIDCConfiguration,
  ): Promise<Configuration> {
    const now = Date.now();
    const cached = this.cache;
    if (cached?.fingerprint === input.fingerprint && cached.expires > now) {
      if (cached.failed)
        throw new ServiceUnavailableException(OIDC_PROVIDER_UNAVAILABLE);
      return cached.value ?? cached.pending;
    }
    const entry = {
      fingerprint: input.fingerprint,
      expires: Infinity,
      pending: undefined,
      value: undefined,
      failed: false,
    };
    this.cache = entry;
    entry.pending = (async () => {
      const oidc = this.library();
      const clientAuth =
        input.authMethod === 'client_secret_basic'
          ? oidc.ClientSecretBasic(input.clientSecret)
          : oidc.ClientSecretPost(input.clientSecret);
      const checkedFetch: import('openid-client').CustomFetch = async (
        url,
        options,
      ) => {
        validateOIDCUrl(String(url), input.allowInsecureHttp);
        const remaining = Math.min(
          5000,
          (this.deadline.getStore() ?? Infinity) - Date.now(),
        );
        if (remaining <= 0)
          throw new ServiceUnavailableException(OIDC_PROVIDER_UNAVAILABLE);
        const signal = AbortSignal.timeout(remaining);
        try {
          const response = await fetch(url, {
            ...(options as RequestInit),
            redirect: 'error',
            signal: options?.signal
              ? AbortSignal.any([options.signal, signal])
              : signal,
          });
          if (response.status >= 500 && response.status <= 599) {
            // A server failure is retryable availability, not bad credentials.
            // Discard its body so vendor diagnostics never reach callers/logs.
            await response.body?.cancel();
            throw new ServiceUnavailableException(OIDC_PROVIDER_UNAVAILABLE);
          }
          return response;
        } catch {
          throw new ServiceUnavailableException(OIDC_PROVIDER_UNAVAILABLE);
        }
      };
      const value = await oidc.discovery(
        new URL(input.discoveryUrl || input.issuer),
        input.clientId,
        {
          client_secret: input.clientSecret,
          id_token_signed_response_alg: 'RS256',
        },
        clientAuth,
        {
          timeout: 5,
          [oidc.customFetch]: checkedFetch,
          execute: [
            ...(input.allowInsecureHttp ? [oidc.allowInsecureRequests] : []),
            oidc.enableNonRepudiationChecks,
          ],
        },
      );
      const m = value.serverMetadata();
      if (
        m.issuer !== input.issuer ||
        !m.jwks_uri ||
        !m.authorization_endpoint ||
        !m.token_endpoint ||
        !m.id_token_signing_alg_values_supported?.includes('RS256') ||
        !m.response_types_supported?.includes('code') ||
        (m.grant_types_supported &&
          !m.grant_types_supported.includes('authorization_code')) ||
        (m.code_challenge_methods_supported &&
          !m.code_challenge_methods_supported.includes('S256')) ||
        !(
          m.token_endpoint_auth_methods_supported ?? ['client_secret_basic']
        ).includes(input.authMethod)
      )
        throw new Error('Unsupported OIDC metadata');
      for (const endpoint of [
        m.issuer,
        m.authorization_endpoint,
        m.token_endpoint,
        m.jwks_uri,
        m.userinfo_endpoint,
      ].filter(Boolean))
        validateOIDCUrl(endpoint, input.allowInsecureHttp);
      entry.value = value;
      entry.expires = Date.now() + 900_000;
      return value;
    })().catch(() => {
      entry.failed = true;
      entry.expires = Date.now() + 5000;
      throw new ServiceUnavailableException(OIDC_PROVIDER_UNAVAILABLE);
    });
    return entry.pending;
  }

  async authorizationUrl(
    config: OIDCConfiguration,
    context: OIDCContext,
    state: string,
  ) {
    const client = await this.configuration(config);
    return this.library().buildAuthorizationUrl(client, {
      redirect_uri: context.callbackUrl,
      scope: config.scope,
      response_type: 'code',
      response_mode: 'query',
      state,
      nonce: context.nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256')
        .update(context.verifier)
        .digest('base64url'),
    });
  }

  async callback(
    config: OIDCConfiguration,
    context: OIDCContext,
    url: URL,
    state: string,
  ): Promise<OIDCVerifiedClaims> {
    return this.deadline.run(Date.now() + 15_000, async () => {
      try {
        const client = await this.configuration(config);
        const oidc = this.library();
        const tokens = await oidc.authorizationCodeGrant(client, url, {
          expectedState: state,
          expectedNonce: context.nonce,
          pkceCodeVerifier: context.verifier,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (
          !claims ||
          claims.iss !== config.issuer ||
          typeof claims.sub !== 'string' ||
          !claims.sub ||
          typeof claims.iat !== 'number' ||
          claims.iat > Date.now() / 1000 + 60 ||
          typeof claims.exp !== 'number' ||
          claims.exp <= Date.now() / 1000 ||
          (claims.nbf !== undefined &&
            (typeof claims.nbf !== 'number' || claims.nbf > Date.now() / 1000))
        )
          throw new Error('Invalid OIDC claims');
        const scopes = config.scope.split(' ');
        const info =
          client.serverMetadata().userinfo_endpoint &&
          (!claims.email ||
            (scopes.includes('profile') &&
              !claims.name &&
              !claims.preferred_username))
            ? await oidc.fetchUserInfo(client, tokens.access_token, claims.sub)
            : undefined;
        return selectOIDCClaims(claims, info);
      } catch (error) {
        if (
          error instanceof ServiceUnavailableException ||
          error?.cause instanceof ServiceUnavailableException
        )
          throw new ServiceUnavailableException(OIDC_PROVIDER_UNAVAILABLE);
        throw new UnauthorizedException(OIDC_AUTHENTICATION_FAILED);
      }
    });
  }
}
