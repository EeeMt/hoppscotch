import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OIDCExceptionFilter } from './oidc-exception.filter';

describe('OIDC error-page trust boundary', () => {
  const config = new ConfigService({
    VITE_BASE_URL: 'https://app.internal/',
    VITE_ADMIN_URL: 'https://admin.internal/',
    VITE_BACKEND_API_URL: 'https://api.internal/backend/v1',
    WHITELISTED_ORIGINS: 'https://app.internal/,https://admin.internal/',
  });
  const render = (exception: unknown) => {
    const res = {
      locals: {},
      headersSent: false,
      end: jest.fn(),
      status: jest.fn(),
      set: jest.fn(),
      type: jest.fn(),
      vary: jest.fn(),
      send: jest.fn(),
    };
    for (const method of ['status', 'set', 'type', 'vary'])
      res[method].mockReturnValue(res);
    const req = {
      get: () => 'text/html',
      accepts: () => 'html',
      acceptsLanguages: () => 'en',
    };
    new OIDCExceptionFilter(config, {} as any).catch(exception, {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as any);
    return {
      status: res.status.mock.calls[0][0],
      html: res.send.mock.calls[0][0] as string,
    };
  };
  it('does not reflect unexpected exception messages or upstream payloads', () => {
    const result = render(new Error('<script>private-client-secret</script>'));
    expect(result.status).toBe(500);
    expect(result.html).not.toContain('private-client-secret');
    const upstream = render(
      new HttpException({ message: '<script>vendor-detail</script>' }, 401),
    );
    expect(upstream.status).toBe(401);
    expect(upstream.html).not.toContain('vendor-detail');
  });
  it('rejects configured destinations outside the allowlist or with non-HTTP protocols', () => {
    const app = config.get('VITE_BASE_URL');
    const allowed = config.get('WHITELISTED_ORIGINS');
    config.set('VITE_BASE_URL', 'javascript:alert(1)');
    config.set('WHITELISTED_ORIGINS', 'javascript:alert(1)');
    try {
      const { html } = render(
        new HttpException('OIDC_INVALID_TRANSACTION', 400),
      );
      expect(html).not.toContain('href=');
      expect(html).not.toContain('javascript:');
    } finally {
      config.set('VITE_BASE_URL', app);
      config.set('WHITELISTED_ORIGINS', allowed);
    }
  });
  it('explains throttling without reflecting the framework error message', () => {
    const result = render(new HttpException('internal throttle detail', 429));
    expect(result.status).toBe(429);
    expect(result.html).toContain('Please wait a moment');
    expect(result.html).toContain('OIDC_RATE_LIMITED');
    expect(result.html).not.toContain('internal throttle detail');
  });
  it('offers return links, without retrying a disabled sign-in method', () => {
    const result = render(new HttpException('OIDC_PROVIDER_DISABLED', 404));
    expect(result.status).toBe(404);
    expect(result.html).not.toContain('id="oidc-retry"');
    expect(result.html).toContain('id="oidc-return-app"');
    expect(result.html).toContain('id="oidc-return-admin"');
  });
});
