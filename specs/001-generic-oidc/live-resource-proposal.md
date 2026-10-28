# Approved additional live OIDC validation resources

The existing independent test application is `hoppscotch-oidc-validation-20261027` (provider 10). Its test group and user already exist. Existing business applications and providers will remain unchanged.

Approved additional resources for T036/T037:

- Application slug: `hoppscotch-oidc-validation-20261027-global`; hidden from the normal application launcher.
- One confidential OAuth2 provider: global issuer `https://auth.ihxq.fun:9999/`, exact callback `http://localhost:3170/v1/auth/oidc/callback`, Authorization Code only, existing RSA signing key referenced without modification, default authentication/implicit-consent/invalidation flows referenced without modification.
- A new email scope mapping that returns only the test user's directory email and omits `email_verified`; default mappings stay unchanged.
- Provider profile claims omitted from the ID token to exercise validated UserInfo fallback; client configured in Hoppscotch with explicit `client_secret_post` and the application's independent discovery URL.
- A policy binding restricting this application to the already-created isolated test group. No new administrator privileges or business policy changes.
- Generated client secret stored only in the ignored `packages/hoppscotch-backend/test/oidc/.local/live-authentik-global.json`, with mode 0600.

Risk: this adds a provider, application, mapping and binding to the shared authentik instance. The resources are separate and removable; the existing test app, users and business providers are not edited by this proposal.

Automatic approval review rejected creation because it considered a second live application outside the explicit request to create one independent app. The user subsequently explicitly approved the second test application. These resources were then created as provider 11 and the global/post/UserInfo real browser chain passed. The earlier approval rejection is resolved.
