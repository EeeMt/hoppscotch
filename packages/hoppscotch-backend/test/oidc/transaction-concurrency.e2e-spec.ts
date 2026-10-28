import request from 'supertest';
import { PrismaService } from 'src/prisma/prisma.service';
import { readOIDCConfiguration } from 'src/auth/oidc/oidc-config';
import { OIDCTransactionService } from 'src/auth/oidc/oidc-transaction.service';
import { createOIDCApplication } from './support/application';

describe('OIDC bound single-use transactions', () => {
  let f: Awaited<ReturnType<typeof createOIDCApplication>>;
  beforeAll(async () => {
    f = await createOIDCApplication();
  });
  afterAll(async () => {
    await f?.close();
  });
  async function pending() {
    const begin = await f.agent.get('/v1/auth/oidc').expect(302);
    const authorized = await fetch(begin.headers.location, {
      redirect: 'manual',
    });
    const callback = new URL(authorized.headers.get('location'));
    const cookie = (begin.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('oidc_'))
      .split(';')[0];
    return { path: callback.pathname + callback.search, cookie };
  }
  it('a different browser cannot consume the initiating browser transaction', async () => {
    const txn = await pending();
    await request(f.server).get(txn.path).expect(400);
    expect(await f.prisma.oIDCLoginTransaction.count()).toBe(1);
    await f.agent.get(txn.path).expect(302);
    await request(f.server).get(txn.path).set('Cookie', txn.cookie).expect(400);
  });
  it('concurrent callbacks racing to consume one state yield only one login', async () => {
    const txn = await pending();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(f.server).get(txn.path).set('Cookie', txn.cookie),
      ),
    );
    expect(results.filter((r) => r.status === 302)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
  });
  it('independent Prisma clients share the atomic consume boundary', async () => {
    const txn = await pending();
    const state = new URL(txn.path, 'http://127.0.0.1').searchParams.get(
      'state',
    );
    const [name, binding] = txn.cookie.split('=');
    const config = readOIDCConfiguration({
      ...f.config.get('INFRA'),
      VITE_BACKEND_API_URL: f.config.get('VITE_BACKEND_API_URL'),
    });
    const second = new PrismaService();
    await second.onModuleInit();
    try {
      const services = [
        f.app.get(OIDCTransactionService),
        new OIDCTransactionService(second),
      ];
      const results = await Promise.allSettled(
        services.map((service) =>
          service.consume(
            state,
            config,
            { cookies: { [name]: binding } } as any,
            { clearCookie: () => undefined } as any,
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    } finally {
      await second.onModuleDestroy();
    }
  });
  it('parallel tabs have independent cookies, and provider errors consume their own state', async () => {
    const first = await pending();
    const second = await pending();
    expect(first.cookie).not.toBe(second.cookie);
    await f.agent.get(second.path).expect(302);
    await f.agent.get(first.path).expect(302);
    const error = await pending();
    const url = new URL(error.path, 'http://127.0.0.1');
    url.searchParams.delete('code');
    url.searchParams.set('error', 'access_denied');
    await f.agent.get(url.pathname + url.search).expect(401);
    await request(f.server)
      .get(error.path)
      .set('Cookie', error.cookie)
      .expect(400);
  });
  it('rejects expiry, duplicate fields, code/error ambiguity and changed configuration', async () => {
    const expired = await pending();
    await f.prisma.oIDCLoginTransaction.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await f.agent.get(expired.path).expect(400);
    await f.app.get(OIDCTransactionService).cleanup();
    expect(await f.prisma.oIDCLoginTransaction.count()).toBe(0);
    const txn = await pending();
    await f.agent.get(txn.path + '&state=duplicate').expect(400);
    await f.agent.get(txn.path + '&error=access_denied').expect(400);
    await f.agent.get(txn.path + '&error=').expect(400);
    f.config.set('INFRA.OIDC_CLIENT_SECRET', 'changed');
    await request(f.server).get(txn.path).set('Cookie', txn.cookie).expect(400);
    f.config.set('INFRA.OIDC_CLIENT_SECRET', 'fixture-secret');
  });
});
