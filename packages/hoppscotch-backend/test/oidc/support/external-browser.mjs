// Drive a deployed AIO image. No Nest/test doubles: the loopback validates the
// returned access token against the deployed backend and never prints tokens.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const live = JSON.parse(
  readFileSync(process.env.OIDC_LIVE_AUTHENTIK_FILE, 'utf8'),
);
const api = live.apiUrl || 'http://localhost:3170/v1';
let loopbackVerified = false;
const loopback = createServer(async (req, res) => {
  res.setHeader(
    'Access-Control-Allow-Origin',
    live.appUrl || 'http://localhost:3000',
  );
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/device-token')
      throw new Error('Wrong loopback route');
    const access = url.searchParams.get('access_token');
    const refresh = url.searchParams.get('refresh_token');
    assert.ok(access && refresh);
    const verified = await fetch(api + '/auth/verify-token', {
      headers: { cookie: 'access_token=' + encodeURIComponent(access) },
    });
    assert.equal(verified.status, 200);
    loopbackVerified = true;
    res.end('ok');
  } catch {
    res.writeHead(400).end();
  }
});
await new Promise((r) => loopback.listen(0, '127.0.0.1', r));
try {
  const child = spawn(
    process.execPath,
    [new URL('./browser-probe.mjs', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        OIDC_LOOPBACK_PORT: String(loopback.address().port),
        OIDC_FIXTURE_ISSUER: live.issuer,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  const exit = await new Promise((r) => child.on('exit', r));
  assert.equal(exit, 0);
  assert.equal(loopbackVerified, true);
  process.stdout.write(
    JSON.stringify({
      ...JSON.parse(output),
      productionAio: true,
      loopbackVerified,
    }),
  );
} finally {
  await new Promise((r) => loopback.close(r));
}
