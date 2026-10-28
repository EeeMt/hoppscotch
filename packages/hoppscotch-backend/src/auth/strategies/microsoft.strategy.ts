import { Strategy } from 'passport-microsoft';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { ConfigService } from '@nestjs/config';
import { validateEmail } from 'src/utils';
import { AUTH_EMAIL_NOT_PROVIDED_BY_OAUTH } from 'src/errors';
import { StatelessStateStore } from '../stateless-state-store';

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {
    super({
      clientID: configService.get<string>('INFRA.MICROSOFT_CLIENT_ID'),
      clientSecret: configService.get<string>('INFRA.MICROSOFT_CLIENT_SECRET'),
      callbackURL: configService.get<string>('INFRA.MICROSOFT_CALLBACK_URL'),
      scope: configService.get<string>('INFRA.MICROSOFT_SCOPE').split(','),
      tenant: configService.get<string>('INFRA.MICROSOFT_TENANT'),
      store: new StatelessStateStore(
        configService.get<string>('INFRA.SESSION_SECRET'),
        undefined,
        (configService.get<string>('INFRA.SESSION_COOKIE_NAME') ||
          '__oauth_nonce') + '_microsoft',
        configService.get<string>('INFRA.ALLOW_SECURE_COOKIES') === 'true',
      ),
    });
  }

  async validate(accessToken: string, refreshToken: string, profile, done) {
    const email = profile?.emails?.[0]?.value;

    if (!validateEmail(email))
      throw new UnauthorizedException(AUTH_EMAIL_NOT_PROVIDED_BY_OAUTH);

    return this.authService.resolveSSOUser(accessToken, refreshToken, profile);
  }
}
