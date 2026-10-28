import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { createOIDCApplication } from './support/application';

describe('OIDC local session boundary', () => {
  let f: Awaited<ReturnType<typeof createOIDCApplication>>;
  beforeAll(async () => {
    f = await createOIDCApplication();
  });
  afterAll(async () => {
    await f?.close();
  });
  it('rejects new authorization while existing access and refresh remain local', async () => {
    expect((await f.login()).status).toBe(302);
    await f.call('controls', { rejectAuthorization: true });
    expect((await f.login(request.agent(f.server))).status).toBe(401);
    const counts = await f.call('counts');
    await f.agent.get('/v1/auth/verify-token').expect(200);
    await f.agent.get('/v1/auth/refresh').expect(200);
    await f.agent.get('/v1/auth/refresh').expect(200);
    expect(await f.call('counts')).toEqual(counts);
  });
  it('rejects a valid signed refresh that does not match the stored hash', async () => {
    const user = await f.prisma.user.findFirst();
    const jwt = f.app.get(JwtService);
    const different = jwt.sign(
      {
        iss: 'http://127.0.0.1:3000',
        aud: ['http://127.0.0.1:3000'],
        sub: user.uid,
        iat: Math.floor(Date.now() / 1000) - 60,
      },
      { expiresIn: 3600 },
    );
    await request(f.server)
      .get('/v1/auth/refresh')
      .set('Cookie', `refresh_token=${different}`)
      .expect(404);
    await f.agent.get('/v1/auth/refresh').expect(200);
  });
  it('logout clears current cookies and preserves the database refresh hash', async () => {
    const before = await f.prisma.user.findFirst();
    const result = await f.agent.get('/v1/auth/logout').expect(200);
    expect(String(result.headers['set-cookie'])).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    expect((await f.prisma.user.findFirst()).refreshToken).toBe(
      before.refreshToken,
    );
    await f.agent.get('/v1/auth/verify-token').expect(403);
  });
  it('deleting the local user rejects both access and refresh', async () => {
    await f.call('controls', { rejectAuthorization: false });
    expect((await f.login()).status).toBe(302);
    await f.prisma.user.deleteMany();
    await f.agent.get('/v1/auth/verify-token').expect(401);
    await f.agent.get('/v1/auth/refresh').expect(401);
  });
});
