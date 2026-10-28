import {
  OIDC_PROVIDER_DISABLED,
  OIDC_PROVIDER_UNAVAILABLE,
  OIDC_INVALID_REQUEST,
  OIDC_INVALID_RETURN_URL,
  OIDC_AUTHENTICATION_FAILED,
} from '../../errors';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as E from 'fp-ts/Either';
import { AuthService } from '../auth.service';
import { authCookieHandler } from '../helper';
import { readOIDCConfiguration } from './oidc-config';
import { OIDCClientAdapter } from './oidc-client.adapter';
import { OIDCTransactionService } from './oidc-transaction.service';
import { OIDCIdentityService } from './oidc-identity.service';

@Injectable()
export class OIDCAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly adapter: OIDCClientAdapter,
    private readonly transactions: OIDCTransactionService,
    private readonly identities: OIDCIdentityService,
    private readonly auth: AuthService,
  ) {}

  private active() {
    const infra = this.config.get<Record<string, string>>('INFRA') ?? {};
    if (!infra.VITE_ALLOWED_AUTH_PROVIDERS?.split(',').includes('OIDC'))
      throw new NotFoundException(OIDC_PROVIDER_DISABLED);
    try {
      return readOIDCConfiguration({
        ...infra,
        VITE_BACKEND_API_URL: this.config.get('VITE_BACKEND_API_URL'),
      });
    } catch {
      throw new ServiceUnavailableException(OIDC_PROVIDER_UNAVAILABLE);
    }
  }

  private returnUrl(value?: string) {
    const app = this.config.get<string>('VITE_BASE_URL');
    const admin = this.config.get<string>('VITE_ADMIN_URL');
    const allowed =
      this.config.get<string>('WHITELISTED_ORIGINS')?.split(',') ?? [];
    const target = value ?? app;
    try {
      const url = new URL(target);
      if (
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        !['http:', 'https:'].includes(url.protocol) ||
        ![app, admin].includes(target) ||
        !allowed.includes(target)
      )
        throw new Error('Invalid return URL');
      return target;
    } catch {
      throw new BadRequestException(OIDC_INVALID_RETURN_URL);
    }
  }

  private headers(res: Response) {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  }

  async begin(req: Request, res: Response) {
    this.headers(res);
    const config = this.active();
    const values = new URL(req.originalUrl, config.callbackUrl).searchParams;
    if (values.getAll('redirect_uri').length > 1)
      throw new BadRequestException(OIDC_INVALID_REQUEST);
    const target = this.returnUrl(values.get('redirect_uri') ?? undefined);
    res.locals.oidcReturnUrl = target;
    // Discover before writing a pending transaction or browser cookie.
    const context = {
      version: 1 as const,
      nonce: '',
      verifier: '',
      issuer: config.issuer,
      clientId: config.clientId,
      callbackUrl: config.callbackUrl,
      returnUrl: target,
    };
    await this.adapter.authorizationUrl(config, context, '');
    const transaction = await this.transactions.create(config, target, res);
    return res.redirect(
      302,
      (
        await this.adapter.authorizationUrl(
          config,
          transaction.context,
          transaction.state,
        )
      ).href,
    );
  }

  async callback(req: Request, res: Response) {
    this.headers(res);
    const config = this.active();
    // Only the query comes from the request; host/proxy headers never define the token redirect URI.
    const query = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    const url = new URL(config.callbackUrl + query);
    const params = url.searchParams;
    for (const key of new Set(params.keys()))
      if (params.getAll(key).length !== 1)
        throw new BadRequestException(OIDC_INVALID_REQUEST);
    if (
      !params.get('state') ||
      params.has('code') === params.has('error') ||
      !(params.get('code') || params.get('error'))
    )
      throw new BadRequestException(OIDC_INVALID_REQUEST);
    const state = params.get('state');
    const context = await this.transactions.consume(state, config, req, res);
    const target = this.returnUrl(context.returnUrl);
    res.locals.oidcReturnUrl = target;
    if (params.has('error'))
      throw new UnauthorizedException(OIDC_AUTHENTICATION_FAILED);
    const claims = await this.adapter.callback(config, context, url, state);
    const user = await this.identities.resolve(claims, config.scope);
    const tokens = await this.auth.generateAuthTokens(user.uid);
    if (E.isLeft(tokens))
      throw new UnauthorizedException(OIDC_AUTHENTICATION_FAILED);
    return authCookieHandler(res, tokens.right, true, target, this.config);
  }
}
