import { fork } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { UserResolver } from 'src/user/user.resolver';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { HttpException, ValidationPipe, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthController } from 'src/auth/auth.controller';
import { AuthService } from 'src/auth/auth.service';
import { OIDCAuthService } from 'src/auth/oidc/oidc-auth.service';
import { OIDCExceptionFilter } from 'src/auth/oidc/oidc-exception.filter';
import { OIDCClientAdapter } from 'src/auth/oidc/oidc-client.adapter';
import { OIDCIdentityService } from 'src/auth/oidc/oidc-identity.service';
import { OIDCTransactionService } from 'src/auth/oidc/oidc-transaction.service';
import { UserService } from 'src/user/user.service';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { MailerService } from 'src/mailer/mailer.service';
import { InfraConfigService } from 'src/infra-config/infra-config.service';
import { OnboardingController } from 'src/infra-config/onboarding.controller';
import { JwtStrategy } from 'src/auth/strategies/jwt.strategy';
import { RTJwtStrategy } from 'src/auth/strategies/rt-jwt.strategy';
import * as helper from 'src/infra-config/helper';

export async function createOIDCApplication() {
  const localEnv = join(__dirname, '../.local/test.env');
  for (const line of readFileSync(localEnv, 'utf8').trim().split('\n')) {
    const index = line.indexOf('=');
    process.env[line.slice(0, index)] = line.slice(index + 1);
  }
  const db = new URL(process.env.DATABASE_URL);
  if (db.hostname !== '127.0.0.1' || db.pathname !== '/oidc_test')
    throw new Error('Refusing non-isolated test database');
  const child = fork(join(__dirname, 'protocol.mjs'), [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    execArgv: [],
  });
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: any) => void }
  >();
  const ready = new Promise<string>((resolve) =>
    child.once('message', (m: any) => resolve(m.issuer)),
  );
  child.on('message', (m: any) => {
    const entry = pending.get(m.id);
    if (!entry) return;
    pending.delete(m.id);
    if (m.error) entry.reject(new HttpException(m.error, m.status));
    else entry.resolve(m.value);
  });
  const call = (action: string, args = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.send({ id, action, args });
    });
  const issuer = await ready;
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  await prisma.oIDCLoginTransaction.deleteMany();
  await prisma.user.deleteMany();
  await prisma.infraConfig.deleteMany();
  process.env.VITE_BASE_URL = 'http://127.0.0.1:3000';
  process.env.VITE_ADMIN_URL = 'http://127.0.0.1:3100';
  process.env.VITE_BACKEND_API_URL = 'http://127.0.0.1:3170/v1';
  const defaults = await helper.getDefaultInfraConfigs();
  const infra = {
    ...Object.fromEntries(defaults.map((c) => [c.name, c.value])),
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'fixture-client',
    OIDC_CLIENT_SECRET: 'fixture-secret',
    OIDC_ALLOW_INSECURE_HTTP: 'true',
    VITE_ALLOWED_AUTH_PROVIDERS: 'OIDC',
    JWT_SECRET: 'isolated-test-jwt-secret',
    MAILER_SMTP_ENABLE: 'false',
    OIDC_CALLBACK_URL: `${process.env.VITE_BACKEND_API_URL}/auth/oidc/callback`,
    RATE_LIMIT_TTL: '10000',
    RATE_LIMIT_MAX: '1000',
  };
  await prisma.infraConfig.createMany({ data: defaults });
  const { encrypt } = await import('src/utils');
  for (const [name, value] of Object.entries(infra)) {
    const encrypted =
      defaults.find((c) => c.name === name)?.isEncrypted ?? false;
    // Defaults already carry encrypted storage; only encrypt explicit runtime overrides here.
    if (
      [
        'OIDC_ISSUER',
        'OIDC_CLIENT_ID',
        'OIDC_CLIENT_SECRET',
        'OIDC_ALLOW_INSECURE_HTTP',
        'VITE_ALLOWED_AUTH_PROVIDERS',
        'JWT_SECRET',
        'OIDC_CALLBACK_URL',
      ].includes(name)
    )
      await prisma.infraConfig.update({
        where: { name },
        data: { value: encrypted ? encrypt(value) : value },
      });
  }
  const stop = jest
    .spyOn(helper, 'stopApp')
    .mockImplementation(() => undefined);
  const mailer = { sendEmail: jest.fn() };
  const config = new ConfigService({
    INFRA: infra,
    VITE_BASE_URL: process.env.VITE_BASE_URL,
    VITE_ADMIN_URL: process.env.VITE_ADMIN_URL,
    VITE_BACKEND_API_URL: process.env.VITE_BACKEND_API_URL,
    WHITELISTED_ORIGINS: `${process.env.VITE_BASE_URL},${process.env.VITE_ADMIN_URL}`,
  });
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      GraphQLModule.forRoot<ApolloDriverConfig>({
        driver: ApolloDriver,
        autoSchemaFile: true,
        context: ({ req, res }) => ({ req, res }),
      }),
      PassportModule,
      JwtModule.register({ secret: infra.JWT_SECRET }),
      ThrottlerModule.forRoot([{ ttl: 10000, limit: 1000 }]),
    ],
    controllers: [AuthController, OnboardingController],
    providers: [
      AuthService,
      OIDCAuthService,
      OIDCExceptionFilter,
      OIDCTransactionService,
      OIDCIdentityService,
      UserService,
      UserResolver,
      InfraConfigService,
      PubSubService,
      JwtStrategy,
      RTJwtStrategy,
      { provide: PrismaService, useValue: prisma },
      { provide: MailerService, useValue: mailer },
      {
        provide: OIDCClientAdapter,
        useValue: {
          authorizationUrl: async (config, context, state) =>
            new URL(await call('authorize', { config, context, state })),
          callback: (config, context, url, state) =>
            call('callback', { config, context, url: url.href, state }),
        },
      },
    ],
  })
    .overrideProvider(ConfigService)
    .useValue(config)
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3100',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3100',
    ],
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableVersioning({ type: VersioningType.URI });
  await app.init();
  const server = app.getHttpServer();
  const agent = request.agent(server);
  const login = async (
    target = agent,
    redirect = process.env.VITE_BASE_URL,
  ) => {
    const begin = await target
      .get('/v1/auth/oidc')
      .query({ redirect_uri: redirect })
      .expect(302);
    const authorize = await fetch(begin.headers.location, {
      redirect: 'manual',
    });
    const callback = new URL(authorize.headers.get('location'));
    return target.get(callback.pathname + callback.search);
  };
  return {
    app,
    prisma,
    agent,
    server,
    config,
    mailer,
    call,
    login,
    close: async () => {
      await app.close();
      child.disconnect();
      stop.mockRestore();
    },
  };
}
