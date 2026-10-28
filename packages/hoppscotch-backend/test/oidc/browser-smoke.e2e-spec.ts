import { execFile } from 'child_process';
import { JwtService } from '@nestjs/jwt';
import { promisify } from 'util';
import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { createOIDCApplication } from './support/application';

// Requires built frontend assets and an explicitly selected isolated Chrome binary.
const browser = process.env.OIDC_CHROME_PATH ? describe : describe.skip;
browser('OIDC browser smoke (all non-loopback HTTP requests blocked)', () => {
  it('logs into app and admin through the real protocol and preserves false verification', async () => {
    const f = await createOIDCApplication();
    const live = process.env.OIDC_LIVE_AUTHENTIK_FILE
      ? JSON.parse(readFileSync(process.env.OIDC_LIVE_AUTHENTIK_FILE, 'utf8'))
      : null;
    if (live) {
      for (const [key, value] of Object.entries({
        OIDC_ISSUER: live.issuer,
        OIDC_DISCOVERY_URL: live.useDiscoveryUrl ? live.discoveryUrl : '',
        OIDC_CLIENT_ID: live.clientId,
        OIDC_CLIENT_SECRET: live.clientSecret,
        OIDC_ALLOW_INSECURE_HTTP: live.issuer.startsWith('http:')
          ? 'true'
          : 'false',
        OIDC_TOKEN_ENDPOINT_AUTH_METHOD:
          live.authMethod || 'client_secret_basic',
      }))
        f.config.set('INFRA.' + key, value);
    }
    const staticServer = (root: string) =>
      createServer(async (req, res) => {
        try {
          const path = new URL(req.url, 'http://localhost').pathname;
          const file = resolve(root, '.' + path);
          if (file !== root && !file.startsWith(root + '/')) {
            res.writeHead(403).end();
            return;
          }
          const target = extname(file) ? file : join(root, 'index.html');
          res.setHeader(
            'content-type',
            (
              {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.json': 'application/json',
                '.svg': 'image/svg+xml',
                '.woff2': 'font/woff2',
              } as Record<string, string>
            )[extname(target)] || 'application/octet-stream',
          );
          res.end(await readFile(target));
        } catch {
          res.writeHead(404).end();
        }
      });
    let loopbackVerified = false;
    const loopback = createServer((req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/controls' && req.method === 'POST' && !live) {
          res.setHeader(
            'Access-Control-Allow-Origin',
            req.headers.origin === 'http://localhost:3100'
              ? 'http://localhost:3100'
              : 'http://localhost:3000',
          );
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () =>
            f.call('controls', JSON.parse(body)).then(() => res.end('ok')),
          );
          return;
        }
        if (url.pathname === '/egress' && req.method === 'POST') {
          res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
          f.call('egress', {
            blocked: url.searchParams.get('blocked') === 'true',
          }).then(() => res.end('ok'));
          return;
        }
        if (url.pathname === '/idp-counts') {
          res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
          f.call('counts').then((counts) => res.end(JSON.stringify(counts)));
          return;
        }
        const jwt = f.app.get(JwtService);
        const access = jwt.verify(url.searchParams.get('access_token'));
        const refresh = jwt.verify(url.searchParams.get('refresh_token'));
        loopbackVerified =
          url.pathname === '/device-token' && access.sub === refresh.sub;
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
        res.end('ok');
      } catch {
        res.writeHead(400).end();
      }
    });
    const app = staticServer(
      resolve(__dirname, '../../../hoppscotch-selfhost-web/dist'),
    );
    const admin = staticServer(
      resolve(__dirname, '../../../hoppscotch-sh-admin/dist'),
    );
    try {
      f.config.set('VITE_BASE_URL', 'http://localhost:3000');
      f.config.set('VITE_ADMIN_URL', 'http://localhost:3100');
      f.config.set('VITE_BACKEND_API_URL', 'http://localhost:3170/v1');
      f.config.set(
        'WHITELISTED_ORIGINS',
        'http://localhost:3000,http://localhost:3100',
      );

      await f.app.listen(3170, '127.0.0.1');
      await new Promise<void>((r) => loopback.listen(0, '127.0.0.1', r));
      await Promise.all([
        new Promise<void>((r) => app.listen(3000, '127.0.0.1', r)),
        new Promise<void>((r) => admin.listen(3100, '127.0.0.1', r)),
      ]);
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [join(__dirname, 'support/browser-probe.mjs')],
        {
          timeout: 90000,
          env: {
            ...process.env,
            OIDC_LOOPBACK_PORT: String((loopback.address() as any).port),
            OIDC_FIXTURE_ISSUER: f.config.get('INFRA.OIDC_ISSUER'),
          },
        },
      );
      const result = JSON.parse(stdout);
      writeFileSync(
        join(__dirname, '.local/last-browser-evidence.json'),
        JSON.stringify(result),
        { mode: 0o600 },
      );
      if (process.env.OIDC_EXPECT_BROWSER_TLS_FAILURE === '1') {
        expect(result).toEqual({
          browserTLSRejected: true,
          noNewLocalSession: true,
        });
        expect(await f.prisma.user.count()).toBe(0);
      } else {
        expect(result).toMatchObject({
          appLogin: true,
          adminLogin: true,
          emailVerified: false,
        });
        if (!live)
          expect(result).toMatchObject({
            onboardingFailureSecretSafe: true,
            onboardingSelectLabels: true,
            appErrorRecovery: true,
            adminErrorRecovery: true,
          });
        expect(loopbackVerified).toBe(true);
      }
      console.log('OIDC browser evidence', result);
      expect(f.mailer.sendEmail).not.toHaveBeenCalled();
    } finally {
      await Promise.all([
        new Promise<void>((r) => app.close(() => r())),
        new Promise<void>((r) => admin.close(() => r())),
        new Promise<void>((r) => loopback.close(() => r())),
      ]);
      await f.close();
    }
  }, 120000);
});
