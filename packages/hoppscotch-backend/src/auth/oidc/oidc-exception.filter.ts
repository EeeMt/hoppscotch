import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { Request, Response } from 'express';

const messages = {
  OIDC_PROVIDER_DISABLED: [
    'This sign-in method is unavailable. Return to choose another method or contact your administrator.',
    '此登录方式不可用，请返回选择其他方式或联系管理员。',
  ],
  OIDC_PROVIDER_UNAVAILABLE: [
    'The identity provider is temporarily unavailable. Please try signing in again.',
    '身份服务暂时不可用，请重新尝试登录。',
  ],
  OIDC_INVALID_REQUEST: [
    'This sign-in request is invalid. Please start a new sign-in.',
    '登录请求无效，请重新发起登录。',
  ],
  OIDC_INVALID_TRANSACTION: [
    'This sign-in request has expired or is invalid. Please start a new sign-in.',
    '登录请求已过期或无效，请重新发起登录。',
  ],
  OIDC_INVALID_RETURN_URL: [
    'The sign-in destination is invalid. Please return to the application to sign in.',
    '登录返回地址无效，请返回应用后重新登录。',
  ],
  OIDC_AUTHENTICATION_FAILED: [
    'Sign-in was cancelled or could not be verified. Please try again.',
    '登录已取消或身份验证失败，请重试。',
  ],
  OIDC_EMAIL_REQUIRED: [
    'Your identity provider must supply a valid email address for your first sign-in. Contact your administrator.',
    '首次登录需要身份服务提供有效邮箱，请联系管理员。',
  ],
  OIDC_IDENTITY_EMAIL_CONFLICT: [
    'This email is already associated with another account. Use its original sign-in method or contact your administrator.',
    '此邮箱已关联其他账号，请使用原登录方式或联系管理员。',
  ],
  OIDC_RATE_LIMITED: [
    'Too many sign-in attempts. Please wait a moment before trying again.',
    '登录尝试过于频繁，请稍后再试。',
  ],
} as const;

const escapeHTML = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

/** Browser navigations get an offline-capable recovery page; API errors keep Nest's JSON contract. */
@Catch()
export class OIDCExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly config: ConfigService,
    private readonly adapter: HttpAdapterHost,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (
      !req.get('accept')?.includes('text/html') ||
      req.accepts(['html', 'json']) !== 'html'
    ) {
      return new BaseExceptionFilter(this.adapter.httpAdapter).catch(
        exception,
        host,
      );
    }
    if (res.headersSent) return res.end();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const response =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const rawCode =
      typeof response === 'string'
        ? response
        : (response as { message?: unknown })?.message;
    // Never render a provider exception, claims, request query or arbitrary error text.
    const code =
      typeof rawCode === 'string' &&
      Object.prototype.hasOwnProperty.call(messages, rawCode)
        ? (rawCode as keyof typeof messages)
        : status === 429
          ? 'OIDC_RATE_LIMITED'
          : 'OIDC_AUTHENTICATION_FAILED';
    const chinese = req.acceptsLanguages('en', 'zh') === 'zh';
    const title = chinese ? '登录未完成' : 'Unable to sign in';
    const allowed =
      this.config.get<string>('WHITELISTED_ORIGINS')?.split(',') ?? [];
    const trusted = (value?: string) => {
      try {
        const url = new URL(value);
        return allowed.includes(value) &&
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
          ? value
          : undefined;
      } catch {
        return undefined;
      }
    };
    const app = trusted(this.config.get<string>('VITE_BASE_URL'));
    const admin = trusted(this.config.get<string>('VITE_ADMIN_URL'));
    // This local is set only after server-side return validation / transaction consumption.
    const previous = res.locals.oidcReturnUrl;
    const target =
      [app, admin].includes(previous) && typeof previous === 'string'
        ? previous
        : (app ?? admin);
    let retry: string | undefined;
    try {
      const base = new URL(this.config.get<string>('VITE_BACKEND_API_URL'));
      if (
        target &&
        code !== 'OIDC_PROVIDER_DISABLED' &&
        ['http:', 'https:'].includes(base.protocol) &&
        !base.username &&
        !base.password &&
        !base.search &&
        !base.hash
      ) {
        base.pathname = base.pathname.replace(/\/+$/, '') + '/auth/oidc';
        base.searchParams.set('redirect_uri', target);
        retry = base.href;
      }
    } catch {
      /* Return links remain available if the backend URL is misconfigured. */
    }
    const link = (href: string | undefined, label: string, id: string) =>
      href ? `<a id="${id}" href="${escapeHTML(href)}">${label}</a>` : '';
    res.vary('Accept').vary('Accept-Language');
    res
      .status(status)
      .set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      })
      .type('html')
      .send(
        `<!doctype html><html lang="${chinese ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Hoppscotch</title><style>:root{color-scheme:light dark}body{margin:0;padding:24px;font:16px/1.6 system-ui,sans-serif;background:#181818;color:#ddd}main{max-width:36rem;margin:12vh auto}h1{font-size:1.6rem;color:#fff}nav{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}a{color:#5ee6b8;padding:10px 16px;border:1px solid #555;border-radius:6px;text-decoration:none}a:focus-visible{outline:3px solid #5ee6b8;outline-offset:3px}code{font-size:.8rem;color:#aaa;overflow-wrap:anywhere}</style></head><body><main><p>HOPPSCOTCH</p><h1>${title}</h1><p>${messages[code][chinese ? 1 : 0]}</p><nav aria-label="${chinese ? '登录操作' : 'Sign-in actions'}">${link(retry, chinese ? '重新登录' : 'Try again', 'oidc-retry')}${link(app, chinese ? '返回应用' : 'Return to application', 'oidc-return-app')}${link(admin, chinese ? '返回管理端' : 'Return to admin', 'oidc-return-admin')}</nav><p><code>${code}</code></p></main></body></html>`,
      );
  }
}
