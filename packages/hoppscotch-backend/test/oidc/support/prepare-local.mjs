import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const local = fileURLToPath(new URL('../.local/', import.meta.url));
mkdirSync(local, { recursive: true, mode: 0o700 });
if (!existsSync(local + 'test.env')) {
  const password = randomBytes(24).toString('hex');
  writeFileSync(
    local + 'postgres.env',
    `POSTGRES_USER=oidc_test\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=oidc_test\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    local + 'test.env',
    `DATABASE_URL=postgresql://oidc_test:${password}@127.0.0.1:54329/oidc_test\nDATA_ENCRYPTION_KEY=${randomBytes(16).toString('hex')}\n`,
    { mode: 0o600 },
  );
}
chmodSync(local + 'test.env', 0o600);
let exists = false;
try {
  exists =
    execFileSync(
      'docker',
      [
        'container',
        'inspect',
        '--format',
        '{{.Config.Image}}',
        'hoppscotch-oidc-test-db',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim() === 'postgres:16-alpine';
} catch {}
if (exists)
  execFileSync('docker', ['start', 'hoppscotch-oidc-test-db'], {
    stdio: 'ignore',
  });
else
  execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      'hoppscotch-oidc-test-db',
      '--label',
      'com.hoppscotch.oidc-test=true',
      '--pull',
      'never',
      '--env-file',
      local + 'postgres.env',
      '-p',
      '127.0.0.1:54329:5432',
      'postgres:16-alpine',
    ],
    { stdio: 'ignore' },
  );
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    execFileSync(
      'docker',
      [
        'exec',
        'hoppscotch-oidc-test-db',
        'pg_isready',
        '-U',
        'oidc_test',
        '-d',
        'oidc_test',
      ],
      { stdio: 'ignore' },
    );
    console.log(
      'Isolated OIDC database ready at 127.0.0.1:54329; credentials are in ignored .local/test.env.',
    );
    process.exit(0);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
throw new Error('Isolated OIDC database did not become ready');
