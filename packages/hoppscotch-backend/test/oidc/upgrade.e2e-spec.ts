import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { createOIDCApplication } from './support/application';
import {
  getDefaultInfraConfigs,
  getMissingInfraConfigEntries,
} from 'src/infra-config/helper';

describe('OIDC additive upgrade and disablement', () => {
  let f: Awaited<ReturnType<typeof createOIDCApplication>>;
  beforeAll(async () => {
    f = await createOIDCApplication();
  });
  afterAll(async () => {
    await f?.close();
  });
  it('backfills existing email rows while retaining nullable email and existing account data', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA oidc_upgrade_snapshot');
      await client.query('SET LOCAL search_path TO oidc_upgrade_snapshot');
      await client.query(
        'CREATE TABLE "User" (uid TEXT PRIMARY KEY, email TEXT UNIQUE); CREATE TABLE "Account" (id TEXT PRIMARY KEY, provider TEXT, "providerAccountId" TEXT)',
      );
      await client.query(
        `INSERT INTO "User" VALUES ('old-email', 'old@internal.example'), ('old-null', NULL), ('old-empty', ''); INSERT INTO "Account" VALUES ('legacy', 'google', 'existing-id')`,
      );
      await client.query(
        readFileSync(
          join(
            __dirname,
            '../../prisma/migrations/20261027000000_oidc_auth/migration.sql',
          ),
          'utf8',
        ),
      );
      const users = await client.query('SELECT * FROM "User" ORDER BY uid');
      expect(users.rows.map((u) => u.emailVerified)).toEqual([
        true,
        false,
        false,
      ]);
      expect((await client.query('SELECT * FROM "Account"')).rows).toEqual([
        { id: 'legacy', provider: 'google', providerAccountId: 'existing-id' },
      ]);
      expect(
        (await client.query('SELECT count(*) FROM "OIDCLoginTransaction"'))
          .rows[0].count,
      ).toBe('0');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
  it('fills missing OIDC keys through the existing infra initialization mechanism', async () => {
    await f.prisma.infraConfig.delete({ where: { name: 'OIDC_SCOPE' } });
    const missing = await getMissingInfraConfigEntries(
      await getDefaultInfraConfigs(),
    );
    expect(missing.map((c) => c.name)).toEqual(['OIDC_SCOPE']);
    await f.prisma.infraConfig.createMany({ data: missing });
  });
  it('disabling OIDC rejects new begin/callback before networking and preserves local sessions', async () => {
    expect((await f.login()).status).toBe(302);
    const before = await f.prisma.account.findFirst();
    f.config.set('INFRA.VITE_ALLOWED_AUTH_PROVIDERS', '');
    const counts = await f.call('counts');
    await f.agent.get('/v1/auth/oidc').expect(404);
    await f.agent.get('/v1/auth/oidc/callback?code=x&state=y').expect(404);
    await f.agent.get('/v1/auth/refresh').expect(200);
    await f.agent.get('/v1/auth/verify-token').expect(200);
    expect(await f.call('counts')).toEqual(counts);
    expect(await f.prisma.account.findFirst()).toEqual(before);
  });
});
