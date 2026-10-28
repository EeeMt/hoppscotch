import { OIDC_INVALID_TRANSACTION } from '../../errors';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHash, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import { decrypt, encrypt } from 'src/utils';
import { OIDCConfiguration, OIDCContext } from './oidc.types';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const random = () => randomBytes(32).toString('base64url');

@Injectable()
export class OIDCTransactionService {
  constructor(private readonly prisma: PrismaService) {}

  private cookie(state: string, config: OIDCConfiguration) {
    return {
      name: `oidc_${hash(state)}`,
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: new URL(config.callbackUrl).protocol === 'https:',
        path: new URL(config.callbackUrl).pathname,
      },
    };
  }

  async create(config: OIDCConfiguration, returnUrl: string, res: Response) {
    const state = random(),
      binding = random();
    const context: OIDCContext = {
      version: 1,
      nonce: random(),
      verifier: random(),
      issuer: config.issuer,
      clientId: config.clientId,
      callbackUrl: config.callbackUrl,
      returnUrl,
    };
    await this.prisma.oIDCLoginTransaction.create({
      data: {
        id: hash(state),
        browserBindingHash: hash(binding),
        encryptedContext: encrypt(JSON.stringify(context)),
        configFingerprint: config.fingerprint,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const cookie = this.cookie(state, config);
    res.cookie(cookie.name, binding, { ...cookie.options, maxAge: 600_000 });
    return { state, context };
  }

  async consume(
    state: string,
    config: OIDCConfiguration,
    req: Request,
    res: Response,
  ): Promise<OIDCContext> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state))
      throw new BadRequestException(OIDC_INVALID_TRANSACTION);
    const cookie = this.cookie(state, config);
    const binding = req.cookies?.[cookie.name];
    res.clearCookie(cookie.name, cookie.options);
    if (typeof binding !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding))
      throw new BadRequestException(OIDC_INVALID_TRANSACTION);
    const where = {
      id: hash(state),
      browserBindingHash: hash(binding),
      configFingerprint: config.fingerprint,
      expiresAt: { gt: new Date() },
    };
    const row = await this.prisma.oIDCLoginTransaction.findFirst({ where });
    if (!row) throw new BadRequestException(OIDC_INVALID_TRANSACTION);
    const deleted = await this.prisma.oIDCLoginTransaction.deleteMany({
      where: { ...where, expiresAt: { gt: new Date() } },
    });
    if (deleted.count !== 1)
      throw new BadRequestException(OIDC_INVALID_TRANSACTION);
    try {
      const context = JSON.parse(decrypt(row.encryptedContext)) as OIDCContext;
      if (
        context.version !== 1 ||
        context.issuer !== config.issuer ||
        context.clientId !== config.clientId ||
        context.callbackUrl !== config.callbackUrl ||
        !/^[A-Za-z0-9_-]{43}$/.test(context.nonce) ||
        !/^[A-Za-z0-9_-]{43}$/.test(context.verifier)
      )
        throw new Error('Invalid context');
      return context;
    } catch {
      throw new BadRequestException(OIDC_INVALID_TRANSACTION);
    }
  }

  @Interval(300_000)
  async cleanup() {
    if (process.env.GENERATE_GQL_SCHEMA === 'true') return;
    await this.prisma.oIDCLoginTransaction.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
  }
}
