import { OIDCVerifiedClaims } from './oidc.types';

/** Inputs are signature-validated ID claims and subject-validated UserInfo. */
export function selectOIDCClaims(
  id: Record<string, unknown>,
  info?: Record<string, unknown>,
): OIDCVerifiedClaims {
  if (
    typeof id.iss !== 'string' ||
    !id.iss ||
    typeof id.sub !== 'string' ||
    !id.sub ||
    (info && info.sub !== id.sub)
  )
    throw new Error('Invalid OIDC identity');
  const source = typeof info?.email === 'string' && info.email ? info : id;
  return {
    issuer: id.iss,
    sub: id.sub,
    email: typeof source.email === 'string' ? source.email : undefined,
    emailVerified: source.email_verified === true,
    name:
      typeof (info?.name ?? id.name) === 'string'
        ? ((info?.name ?? id.name) as string)
        : undefined,
    preferredUsername:
      typeof (info?.preferred_username ?? id.preferred_username) === 'string'
        ? ((info?.preferred_username ?? id.preferred_username) as string)
        : undefined,
  };
}
