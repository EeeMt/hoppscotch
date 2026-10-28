import { createHash } from 'crypto';
import { OIDCConfiguration } from './oidc.types';

export const OIDC_DEFAULTS = {
  OIDC_ISSUER: '',
  OIDC_DISCOVERY_URL: '',
  OIDC_CLIENT_ID: '',
  OIDC_CLIENT_SECRET: '',
  OIDC_SCOPE: 'openid,profile,email',
  OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_basic',
  OIDC_ALLOW_INSECURE_HTTP: 'false',
};

export function validateOIDCUrl(
  value: string,
  allowHttp: boolean,
  issuer = false,
) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (issuer && url.search) ||
    !['https:', ...(allowHttp ? ['http:'] : [])].includes(url.protocol)
  ) {
    throw new Error('Invalid OIDC URL');
  }
  return url;
}

export function readOIDCConfiguration(
  input: Record<string, string>,
  enabled = true,
): OIDCConfiguration {
  // Transformed DTOs have own properties with undefined values for omitted
  // fields. Preserve defaults for those, while still rejecting explicit blanks.
  const values = {
    ...OIDC_DEFAULTS,
    ...Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ),
  };
  const http = values.OIDC_ALLOW_INSECURE_HTTP;
  if (http !== 'true' && http !== 'false')
    throw new Error('Invalid OIDC HTTP option');
  const authMethod = values.OIDC_TOKEN_ENDPOINT_AUTH_METHOD;
  if (
    authMethod !== 'client_secret_basic' &&
    authMethod !== 'client_secret_post'
  )
    throw new Error('Invalid OIDC client authentication');
  if (values.OIDC_ISSUER)
    validateOIDCUrl(values.OIDC_ISSUER, http === 'true', true);
  if (values.OIDC_DISCOVERY_URL)
    validateOIDCUrl(values.OIDC_DISCOVERY_URL, http === 'true');
  const scopes = [
    ...new Set(
      values.OIDC_SCOPE.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (
    !scopes.includes('openid') ||
    scopes.some((s) => !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(s))
  )
    throw new Error('Invalid OIDC scope');
  if (
    enabled &&
    (!values.OIDC_ISSUER ||
      !values.OIDC_CLIENT_ID?.trim() ||
      !values.OIDC_CLIENT_SECRET?.trim())
  )
    throw new Error('Incomplete OIDC configuration');
  const backend = input.VITE_BACKEND_API_URL?.replace(/\/+$/, '');
  const callbackUrl = backend
    ? `${backend}/auth/oidc/callback`
    : input.OIDC_CALLBACK_URL;
  if (enabled && !callbackUrl) throw new Error('Missing OIDC callback');
  if (callbackUrl) validateOIDCUrl(callbackUrl, true);
  const config = {
    issuer: values.OIDC_ISSUER,
    discoveryUrl: values.OIDC_DISCOVERY_URL || undefined,
    clientId: values.OIDC_CLIENT_ID,
    clientSecret: values.OIDC_CLIENT_SECRET,
    callbackUrl,
    scope: scopes.join(' '),
    authMethod: authMethod as OIDCConfiguration['authMethod'],
    allowInsecureHttp: http === 'true',
  };
  return {
    ...config,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(config))
      .digest('hex'),
  };
}
