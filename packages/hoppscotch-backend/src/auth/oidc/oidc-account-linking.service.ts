import { OIDC_IDENTITY_EMAIL_CONFLICT } from '../../errors';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from 'src/generated/prisma/client';
import { lockLoginEmail } from './oidc-email-lock';

@Injectable()
export class OIDCAccountLinkingService {
  constructor(private readonly prisma: PrismaService) {}

  async withLegacyLogin<T>(
    email: string,
    provider: string,
    providerAccountId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await lockLoginEmail(tx, email);
      await this.assertLegacyLoginAllowed(
        email,
        provider,
        providerAccountId,
        tx,
      );
      return operation(tx);
    });
  }

  async assertLegacyLoginAllowed(
    email: string,
    provider: string,
    providerAccountId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const oidc = await db.account.findFirst({
      where: {
        provider: 'oidc',
        user: { email: { equals: email.trim(), mode: 'insensitive' } },
      },
    });
    if (!oidc) return;
    const existing = await db.account.findUnique({
      where: {
        verifyProviderAccount: { provider, providerAccountId },
      },
    });
    if (!existing || existing.userId !== oidc.userId)
      throw new ConflictException(OIDC_IDENTITY_EMAIL_CONFLICT);
  }
}
