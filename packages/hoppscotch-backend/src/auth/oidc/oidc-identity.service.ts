import {
  OIDC_AUTHENTICATION_FAILED,
  OIDC_EMAIL_REQUIRED,
  OIDC_IDENTITY_EMAIL_CONFLICT,
} from '../../errors';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { validateEmail } from 'src/utils';
import { OIDCVerifiedClaims } from './oidc.types';
import { lockLoginEmail } from './oidc-email-lock';

@Injectable()
export class OIDCIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(claims: OIDCVerifiedClaims, scope: string) {
    if (!claims.issuer || !claims.sub)
      throw new UnauthorizedException(OIDC_AUTHENTICATION_FAILED);
    const identity = {
      provider: 'oidc',
      providerAccountId: JSON.stringify([claims.issuer, claims.sub]),
    };
    const where = { verifyProviderAccount: identity };
    const email = claims.email?.trim().toLowerCase();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // Share an email lock across independent OIDC identities, including casing variants.
          if (email) await lockLoginEmail(tx, email);
          const account = await tx.account.findUnique({
            where,
            include: { user: true },
          });
          if (account) {
            await tx.account.update({ where, data: { loggedIn: new Date() } });
            return tx.user.update({
              where: { uid: account.userId },
              data: {
                lastLoggedOn: new Date(),
                ...(email && account.user.email?.toLowerCase() === email
                  ? { emailVerified: claims.emailVerified === true }
                  : {}),
              },
            });
          }
          if (!email || !validateEmail(email))
            throw new UnauthorizedException(OIDC_EMAIL_REQUIRED);
          const conflict = await tx.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
          });
          if (conflict)
            throw new ConflictException(OIDC_IDENTITY_EMAIL_CONFLICT);
          return tx.user.create({
            data: {
              email,
              emailVerified: claims.emailVerified === true,
              displayName: claims.name || claims.preferredUsername || email,
              isAdmin: false,
              lastLoggedOn: new Date(),
              providerAccounts: {
                create: {
                  ...identity,
                  providerScope: scope,
                  providerAccessToken: null,
                  providerRefreshToken: null,
                },
              },
            },
          });
        });
      } catch (error) {
        if (error.code !== 'P2002' && error.code !== 'P2034') throw error;
        // Retry the complete identity lookup after the failed transaction rolls back.
        if (attempt === 2)
          throw new ConflictException(OIDC_IDENTITY_EMAIL_CONFLICT);
      }
    }
  }
}
