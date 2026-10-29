# OIDC implementation validation

Date: 2026-10-29. Status: Web implementation and acceptance complete, with the LAN login-dialog refresh below. The user explicitly removed native desktop build/runtime acceptance from this delivery; browser device-login/loopback evidence remains recorded separately.

## Current verified result

Implementation commit: `69c9e4cbf` (`feat(auth): add generic OIDC sign-in for self-hosted web`).

| Check | Latest result |
|---|---|
| Affected backend units | 147 passed / 10 suites |
| Complete OIDC e2e, including Chrome interactions | 40 passed / 11 suites |
| Real-library protocol tests on production Node 24 | 41 passed, container egress disabled |
| Production builds | Backend, admin and AIO passed |
| Actual authentik Web/admin, refresh/logout and loopback | Passed; 11 Me queries preserve emailVerified=false, no outside-allowlist requests |
| Fixture browser recovery and bilingual controls | App/admin return and retry passed; 20 Me queries, no outside-allowlist requests |
| Credential scan | No known live credential/key matches; local credentials, trust material and offline archive ignored |

The baseline image and offline archive contain `sha256:f2ccf3ea4412381f062c6b70cd1316864a171bf496ed5f42239a67f6565aed04`. The LAN deployment now uses the Web-only update below. Existing unrelated frontend typecheck failures and the six legacy auth-controller lint errors are documented below. Native desktop build/runtime is excluded by the user's explicit scope decision. The following sections retain earlier acceptance runs and review history.

## LAN login-dialog refresh — 2026-10-29

- The Web OIDC selector now includes the Hoppscotch logo, workspace introduction, a prominent organization-account action, and a localized explanation of the identity-provider redirect. Colors follow the existing theme and accent settings. Other configured login methods remain available.
- The action exposes an accessible label, description, keyboard focus indicator and busy state. Duplicate clicks are ignored. A synchronous or asynchronous launch failure allows retry, and `pageshow` restores the button after browser Back.
- Common component and OIDC helper suites: **11 tests passed in 3 files**. Covers the single action, named providers, other login methods, disabled OIDC, progress, duplicate navigation, failure/retry and browser-return event. Affected Vue files pass ESLint; the self-host Web production build passes.
- Real Chrome checks: desktop English/light at 1440px and mobile Chinese/dark at 390px; the action remains inside the viewport, its translated accessible label is present, and neither viewport has horizontal page overflow. Enter opens the identity provider, browser Back permits another sign-in (reopening the dialog after a full reload), and Escape dismisses the dialog.
- Real LAN Web/admin login, local refresh and logout passed using the isolated test account and normal TLS validation. **7 Me queries**, `emailVerified=false`, **0 outside-allowlist browser requests**. Native desktop acceptance remains excluded.
- At the user's additional request, provider 11 retains an independent authentik authentication flow, `hoppscotch-oidc-validation-20261027-login`, with a persistent SVG background, sidebar layout, combined username/password form and password visibility control. All four original stage bindings and their password/MFA policy parameters are preserved. The shared brand/default flow and business applications are unchanged. The requested existing account still passes the application's access policy. The asset and scoped replay helper remain in ignored `.local/` files.
- Current LAN app: `http://192.168.50.13:3000`; admin: `/admin`; API: `/backend/v1`. Runtime image `hoppscotch-oidc:login-ui`, ID `sha256:cf5cb82df50390a81077a7bd95a91bab44d4c6b23fde295d027bc129fcb745e6`, retains the baseline backend/admin and replaces only the built Web directory. Existing isolated database and runtime configuration are retained; container health passes.

## Logout-dialog refresh — 2026-10-29

- The common logout dialog now follows the login dialog's logo, spacing and accent treatment, displays the current account, and explains that local logout leaves an SSO identity-provider session intact. English and Chinese strings are included.
- Confirmation remains visible while sign-out is pending. Duplicate submissions and dismissal are blocked during the request; a failure keeps the dialog open with an inline error and enables retry. Cancel receives initial focus, Escape cancels an idle dialog, and reopening clears previous errors. The existing organization redirect and logout shortcut remain intact.
- Login/logout component and OIDC helper suites: **15 tests passed in 4 files**. Component tests use the actual shared modal and buttons for logout. Affected components and tests pass ESLint and formatting checks; the browser probe passes syntax and formatting checks; the self-host Web production build passes with an explicit local `VITE_BASE_URL`. Full self-host `vue-tsc --noEmit` still reports the previously documented common-module alias and GraphQL version/type failures.
- Isolated Chrome component previews with simulated accounts passed desktop English/light, desktop Chinese/dark, mobile Chinese/light at 390px, mobile English/dark at 320px with long account details, and a platform without OIDC. No horizontal overflow was observed, all action buttons fit the viewport, and the SSO note follows platform support. Busy-state locking, duplicate prevention, failure/retry and successful dismissal passed without uncaught browser exceptions.
- These logout checks cover local code and component previews. The LAN runtime image above remains the earlier login-dialog deployment; this logout refresh has not been deployed there, and no new identity-provider round trip is claimed for it.

## Environment

- Target: `https://auth.ihxq.fun:9999`. This entry is not assumed to be the application's issuer.
- Sandboxed anonymous HEAD: DNS resolution failed (`curl: (6) Could not resolve host`).
- Host anonymous HEAD with network access: HTTP/2 302 to authentik's authentication flow; normal TLS validation succeeded. No credentials were used.
- Host: Node `v26.5.0`, pinned pnpm `10.34.5`. CI Node 22 and production Node 24 remain unchanged; the full real-library fixture suite passed on production Node v24.21.0.
- Docker engine: `29.2.1`; accessible outside the sandbox. Node 24 backend-container discovery at the real authentik target passed with normal TLS validation. Chrome 156.0.8078.48 completed real default/global/HTTP browser logins.
- authentik: 2026.5.3, image `ghcr.io/goauthentik/server@sha256:377ee38726785f98aafc3665202ad198a366fa979b0f61c0660a9c05e3a9b1b3`. Target and local management endpoint were matched by their public RSA JWKS fingerprint before provisioning.
- Independent default Application: `hoppscotch-oidc-validation-20261027`, provider 10; restricted to dedicated test group. Independent global/post/UserInfo Application: `hoppscotch-oidc-validation-20261027-global`, provider 11, separately approved by the user after automatic review initially rejected the additional shared-service resources.
- Non-admin authentik test user ID 13, dedicated group `7fb86d85-c51b-48e6-8f0d-6fd03cc3f423`. Business providers, signing keys, certificates, users and policies were not modified. Test applications reference the existing RSA key without modifying it.
- Client secrets and test password are in ignored `.local/live-authentik*.json` files with mode 0600; they are not included here.
- Default issuer: `https://auth.ihxq.fun:9999/application/o/hoppscotch-oidc-validation-20261027/`; discovery appends `.well-known/openid-configuration`.
- Global issuer: `https://auth.ihxq.fun:9999/`; independent discovery: `https://auth.ihxq.fun:9999/application/o/hoppscotch-oidc-validation-20261027-global/.well-known/openid-configuration`.
- Exact browser callback: `http://localhost:3170/v1/auth/oidc/callback`; test app/admin bases: `http://localhost:3000` and `http://localhost:3100`.
- Protocol metadata advertises RS256, basic/post and S256; global test omits ID-token profile and supplies email without email_verified through UserInfo.
- Isolated private-CA proxy: `https://localhost:9444/`; HTTP proxy: `http://localhost:9080/`. Metadata issuer and authorization/token/JWKS/UserInfo endpoints were checked to use these entries. Caddy v2.11.4 image digest: `ghcr.io/windmill-labs/caddy-l4@sha256:4ce435394134686743a25cca90a17a2b5a96077adbc316a8f842316baefe91bd`. Business ingress is unchanged. The real private-CA matrix passed: trusted Node/browser login succeeds; absent/removed Node trust returns 503 in new processes; standard hostname verification rejects mismatch; Chromium without the CA rejects authorization with no local session. CA trust was confined to the isolated Linux browser container; macOS trust was untouched.
- Offline AIO: dedicated Docker internal-only network with a fresh database; a TCP gateway forwards encrypted traffic only to the explicitly resolved authentik address on port 9999. A separate incoming gateway exposes loopback app/admin/API ports. Backend public HTTPS requests fail while real IdP discovery succeeds. Browser and protocol fixtures also enforce host allowlists. No business network rules changed.

## Evidence

Only checks explicitly recorded with results count as executed. Credentials, cookies, tokens, signing keys and CA private keys must stay outside this document and source control.

## Scope and remaining limitations

All required Web acceptance completed, including the repeated migrated-database settings run. Native desktop build/runtime acceptance was explicitly removed by the user. Existing unrelated full frontend typecheck failures remain; production app/admin/AIO builds and focused tests pass. No business deployment was performed. Local commits were subsequently created at the user's request; the implementation commit is identified above. Browser device-login/loopback success is recorded only as that result. Fixture and live evidence remain separate.


## Executed checks

| Check | Result | Evidence / limit |
|---|---|---|
| Prisma generate and 23 migrations | PASS | Dedicated PostgreSQL 16.14, `oidc_test` at loopback port 54329. Migration snapshot covers existing email/null/empty rows and unchanged Account data. |
| Backend official clean build | PASS | `pnpm --filter hoppscotch-backend run build`; direct tsc emission followed by incremental Nest start initially produced stale path aliases, resolved by the existing clean build command without changing architecture. |
| Schema + admin/selfhost codegen | PASS | Root gen-gql followed by both generators; all five schema/client artifacts reproduced byte-for-byte on repeat. Generated files remain under the repository's existing ignore rules. |
| Backend targeted unit tests | PASS | 142 tests / 9 suites, including configuration, identity/transaction, legacy fixtures, auth sessions, UserService and existing redirect validation. |
| Database/REST/GraphQL + fixture browser e2e | PASS | 29 tests / 9 suites with Chrome enabled, including deterministic cross-provider races and deletion subscription fields. Real auth/onboarding/Me routes and PostgreSQL; real openid-client in a Node subprocess. Mail delivery and stopApp are test seams. |
| Real-library protocol suites on Node 24 | PASS | 33 tests, including private-CA fixture, wrong claims/signatures, UserInfo, rotation, cache recovery, five-second operations and fifteen-second callback budget. Node image `node@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0`. |
| Common UI tests | PASS | 6 tests covering exact provider parsing, single button, verification capability and fixed device-login restoration. |
| Admin production build | PASS | Built with the example local URLs for browser acceptance. |
| Selfhost production build | PASS | Existing data/kernel/sandbox/editor workspace build prerequisites and common codegen were prepared first; example URLs loaded for sitemap generation. |
| Full frontend typechecks | FAIL, existing issues | Admin: untouched Header, Invite, toast and user/team pages. Selfhost: existing common alias/type errors, GraphQL 16.14.0 vs 16.13.2 document types and existing AuthEvent/unknown result types. These were not broadened into the OIDC scope. |
| Default real authentik browser chain | PASS | OIDC-only onboarding, app/admin login, false email verification, refresh/logout and fixed device-login/real loopback token verification. Browser allowed loopback plus the configured authentik host; 0 other requests attempted. |
| Global/post/UserInfo real authentik browser chain | PASS | Same chain against provider 11; exact global issuer with independent discovery, post client authentication, UserInfo-only profile and missing email_verified. |
| Explicit HTTP real authentik browser chain | PASS | Same chain through the isolated localhost:9080 entry; HTTP is enabled only in that test configuration. Default HTTP rejection is covered by configuration and real-library fixtures. |

## Browser evidence

`browser-smoke.e2e-spec.ts` runs actual compiled app/admin UIs in an isolated Chrome profile, against real Nest routes, PostgreSQL and the real protocol library. It drives the onboarding form, the OIDC button, authentik username/password and stay-signed-in stages, app/admin state, refresh/logout, device-login restoration and the existing loopback handshake. It observes Me queries containing emailVerified (13 in the latest live runs); both clients retain false. It blocks network requests outside loopback and the explicitly configured IdP host. This is not a full production AIO restart or host firewall isolation test.

The test-user password and client secret are injected from the ignored file into the isolated browser only; protocol query strings, cookies, tokens and credentials are not printed. Expected pre-login missing-refresh errors from the existing local strategy contain no cookie values.


## Real private CA / HTTP evidence (SC-002)

- The private-CA gateway proxies the same verified authentik 2026.5.3 instance. Its global-provider metadata uses `https://localhost:9444/` as issuer and uses that entry for authorization, token, JWKS and UserInfo. The full onboarding/app/admin/device browser chain passed with Node 24.21.0 and Chromium 156.0.8078.47 in an isolated Linux container, with the CA trusted in that container's NSS database and NODE_EXTRA_CA_CERTS set before Node starts.
- Node absent CA and removed CA were each tested in fresh processes/cold adapter caches: controlled 503, no TLS override. Node's standard checkServerIdentity against the actual served certificate rejects `mismatch.internal` with ERR_TLS_CERT_ALTNAME_INVALID.
- Removing the CA from the isolated browser's NSS database while leaving Node trust configured causes ERR_CERT_AUTHORITY_INVALID; the browser test confirms no local auth cookies and no new database user. The CA was restored in that container after the negative test. The browser did not bypass the certificate error.
- The separate `http://localhost:9080/` entry passed the actual full browser chain when explicitly enabled. Its default/disabled HTTP option was rejected before discovery in a fresh Node process.
- Fixture TLS tests remain separate: the 33-test Node protocol suites use a generated ephemeral CA. They are not the evidence used for the real authentik matrix above.
- Container setup supplied the missing Linux `@unrs/resolver-binding-linux-arm64-gnu@1.11.1` binary inside `/tmp/oidc-native` (NODE_PATH), because host dependencies were installed for macOS. No host package versions or CI matrix were changed. Chromium root execution disables the container browser sandbox only; there are no certificate-bypass switches.


## IdP disablement evidence (FR-015 / SC-006)

The live default authentik browser test passed with OIDC_TEST_DISABLE_USER=1. It established session A, temporarily disabled only the dedicated non-admin authentik test user, then launched a second isolated Chrome profile B. B's real authentik login reported a flow response error and produced no local auth cookies. A continued to pass `/auth/verify-token` and `/auth/refresh`; protocol-worker request counters were identical immediately before and after these local requests (0 IdP requests). The test restored the user in cleanup; a separate authentik model read confirmed is_active=True. No successful login of that user occurred between disablement and A's refresh check, preserving the existing single refresh-hash semantics.

The fixture and real browser support now count protocol fetches. The protocol subprocess rejects egress outside loopback or the explicitly selected live IdP hostname; the browser applies the matching allowlist. No business firewall rules were changed.


## Live cancellation and recovery (T037)

The global/post/UserInfo test passed OIDC_TEST_RECOVERY=1: after session A, the test worker temporarily denied all OIDC backchannel fetches. A fresh isolated browser B completed IdP authorization but received controlled OIDC_PROVIDER_UNAVAILABLE at callback and no local auth cookies. Restoring backchannel access allowed subsequent admin and device logins without restarting the backend.

The global test also passed OIDC_TEST_CANCELLATION=1. Only test provider 11 temporarily referenced the existing explicit-consent flow; cleanup restored its implicit-consent flow. The browser accepted consent for A, removed only this test user's grant for this test app, and opened a fresh browser B. B followed authentik's own `/flows/-/cancel/` link at consent. authentik 2026.5.3 cancels the flow without returning an OAuth error to the callback; B acquired no local session and A remained usable. The fixture suite separately covers a bound `error=access_denied` callback and single transaction consumption. No shared flow/stage or business grants were edited.


## Production AIO and offline acceptance (T058/T060)

- Built `prod.Dockerfile --target aio --build-arg HOPP_BUILD_NODE_HEAP_MB=6656`; image ID `sha256:6ab7d9122ce7be46b70cf4baf939cd0dbfbb5b5aa63e395b14ba5707dc37bbbd`. Default heap stays 8192 MiB. Docker's 11.65 GiB VM could not sustain the default alongside existing business containers; 5120 MiB also exhausted V8. The 6656 MiB build passed without stopping those containers. A build-time VITE_BASE_URL default was added for sitemap generation with all real .env files excluded. `.env.example` is explicitly retained as a build input.
- Saved and loaded AIO, PostgreSQL 16.14 and Node 24 images using `docker image save/load`. Migration and deployment used `--pull=never`; no install/build/pull ran in the isolated runtime. New database `oidc_aio` had empty discovery/JWKS caches at first login. SMTP/EMAIL and analytics were disabled.
- Only AIO and database attach directly to `hoppscotch-oidc-offline` (`Internal=true`). The IdP gateway accepts TCP 9999 and forwards to one fixed resolved target/port; it preserves TLS through to authentik and provides no general proxy. The incoming gateway forwards only ports 3000/3100/3170 to AIO. Public HTTPS from AIO failed; normal TLS discovery of the configured authentik app succeeded. Source helpers: `test/oidc/support/idp-relay.mjs`, `aio-ingress.mjs`; reusable topology: `fixtures/offline.compose.yml`.
- Real compiled UI and production backend passed OIDC-only onboarding, app login, admin bootstrap/login, local refresh/logout and device-login restore/loopback verification. `external-browser.mjs` verifies the returned access token against the deployed `/auth/verify-token`; it never prints tokens. Me queries containing emailVerified: 13; false retained; browser requests outside loopback/configured IdP: 0.
- Gateway snapshot after this chain: 3 TLS connections, 8001 encrypted bytes to IdP and 29663 encrypted bytes from IdP. This counts encrypted traffic, not OAuth payloads. AIO restarted twice through its existing initialization/configuration mechanism. No SMTP server is configured or reachable as an allowed external target.
- Actual subpath AIO then passed the same chain using a separate new database: app `http://localhost:3000`, admin `http://localhost:3000/admin`, API `http://localhost:3000/backend/v1`; exact derived callback `http://localhost:3000/backend/v1/auth/oidc/callback`. Only isolated test provider 11 received that additional strict callback. Global issuer, independent discovery, post client authentication and UserInfo-only profile remained in use. No wildcard callback was added.

## Real admin settings acceptance

The actual subpath AIO passed UI settings save with OIDC scope reordered to `openid,email,profile`, callback disabled/read-only and client secret masked. First-admin setup explicitly disabled both analytics and newsletter before continuing. The settings UI triggered the existing real stop/restart process. A pending authorization from the former configuration then failed at callback with 400; the secret remained unchanged.

Guarded admin mutations temporarily configured an unused dummy Google option solely to satisfy the existing at-least-one-provider rule, disabled OIDC, and restarted AIO. New begin/callback returned 404 while local refresh returned 200. Re-enabling OIDC and disabling the dummy option restored real login. There was no Google authorization/network request. Client secret remained identical through save, disable and re-enable; the stable Account identity-field hash was identical before/after. The run observed 17 Me queries carrying emailVerified and 0 outside-allowlist browser requests.

## Final checks and scope

Final reruns: official backend build PASS; targeted backend tests 142/142 across 9 suites; complete OIDC e2e directory 29/29 across 9 suites; both real-library Node 24 suites 33/33 with container egress disabled; common UI tests 6/6. The browser e2e additionally verifies true and false in app/admin state and a separately authenticated second user's `isAdmin=false`; its final evidence artifact records 17 Me requests with emailVerified and 0 outside-allowlist requests. An initial Chrome debugging-port startup race and a test-only controls endpoint CORS omission were corrected; the complete e2e rerun passed.

The pinned pnpm signature verification needs registry access on this host; sandboxed invocations failed to fetch signature metadata and were rerun with normal connectivity. Verification was never disabled. Existing unrelated frontend typecheck failures remain as recorded above; both production UIs and the AIO image build successfully.


## Migrated deployment acceptance (T056)

Created a separate `oidc_upgrade` database by deploying all migrations preceding this feature from an ephemeral copy of the production image. Seeded synthetic existing email/null users and a Google Account, then applied the OIDC migration using the unmodified image. Email backfill returned true for the existing nonempty email and false for null. With the dedicated IdP relay stopped, AIO started, returned an empty active-provider list, and initialized all eight OIDC keys. The relay was then restored. Separately, the production image generated its complete GraphQL schema under `--network none`, with placeholder credentials and no database or IdP.

Actual browser onboarding/login succeeded on the upgraded database. Its existing users correctly prevented automatic admin elevation of the new OIDC user. The isolated test setup explicitly granted that local OIDC user admin for settings acceptance; this was not an IdP role/group mapping or an application behavior change. The repeated settings save, fingerprint rejection, disable/enable, secret preservation and local refresh checks then all passed; subsequent real admin/device logins passed, with 17 Me requests carrying emailVerified and 0 outside-allowlist browser requests.

Afterward a database assertion confirmed the synthetic legacy Account's ID, provider, providerAccountId, userId, scope and null provider tokens remained intact. Its original loggedIn timestamp still precedes the OIDC migration, proving the record was not rewritten during these logins/settings changes. Legacy email/null backfill remained correct. The deployment ended with OIDC only, analytics=false and SMTP=false.

## Final security review (T061)

- Authorization/callback use only configured issuer/client/callback and exact allowlisted app/admin returns. Forwarded host headers cannot alter callback. Callback duplicates, code/error ambiguity, missing browser binding, expiry, changed configuration and replay are rejected. Both OIDC routes inherit the auth controller's throttler; neither skips it.
- State and browser binding each use 256 random bits; only their hashes are stored. Nonce/verifier/context use existing encrypted storage. Browser binding is HttpOnly, host-only, SameSite=Lax and callback-path scoped, Secure for HTTPS, ten-minute TTL. Conditional atomic deletion is checked before code exchange; cleanup removes expired rows. Context is not returned or logged.
- The real library performs signature/issuer/audience/nonce/PKCE checks; exact issuer and standard time checks remain enforced. UserInfo uses the verified subject and email/verification from the same source. No provider token, remote avatar fetch, SMTP, public proxy or public identity service is added to OIDC login. Local JWT refresh/signing/hash behavior remains unchanged.
- Morgan logs paths without query strings. OIDC services and adapters do not print credentials, tokens, cookies, verifier or full claims. Removed desktop token console output from the selfhost Login component. Live credential/key values were scanned against 2566 Git-visible files and 50 local acceptance logs with zero matches; the final scan includes current runtime logs. Ignored `.local` files and image archives remain outside Git/build context, and the runtime image excludes local credential files.
- HTTPS uses normal Node/browser certificate and hostname checks. Private CA trust is supplied before Node starts; no TLS-disable environment setting or certificate-bypass browser flag is used. Explicit HTTP applies only to the selected configuration. Fetch redirects are rejected; per-operation and total callback budgets passed their real-library tests.
- Dependency delta is only exact `openid-client@6.8.8` plus `oauth4webapi@3.8.8` and `jose@6.2.13`. Backend stays CommonJS with lazy require(esm), tested on existing production Node 24; no runtime upgrade or discovery at startup/codegen. Focused OIDC ESLint and git diff whitespace checks pass.

## Requirement evidence index

| Requirement | Evidence |
|---|---|
| FR-001 | Config enum/defaults/DTO, provider parsing tests, actual OIDC-only onboarding and settings. |
| FR-002 | Both 33-test Node suites; actual default/basic and global/independent discovery/post/UserInfo chains. |
| FR-003 | Real-library negative signature/claims/nonce/PKCE cases; bound callback e2e. |
| FR-004 | Transaction unit tests and PostgreSQL races: five callbacks/one winner, two independent Prisma clients/one consumer, parallel-tab cookies, TTL/cleanup/replay/config-change checks. |
| FR-005 | Identity concurrency and legacy login fixtures; eight same-identity first logins yield one User/Account; case-equivalent email races yield one identity, no merge; reverse-link guard in all four legacy methods. |
| FR-006 | Profile/claim unit tests, false/missing live claims, UserInfo-only live case, true/false browser state and second-user authorization. |
| FR-007 | Imported production AIO on internal-only network, no SMTP, public egress failure, cold-cache real login and local refresh/logout. |
| FR-008 | Real authentik private-CA/HTTP matrix plus separate ephemeral fixture matrix. |
| FR-009 | Built Web/admin interfaces, generic en/cn wording, one OIDC button, actual Me state and settings UI. Native runtime explicitly excluded by user. |
| FR-010 | Local session e2e and existing auth tests; first-user bootstrap, second-user non-admin and migrated-user no-elevation behavior. |
| FR-011 | Encrypted storage assertions, null IdP token assertions, final secret/log/dependency review above. |
| FR-012 | Existing provider fixtures, lazy cache/failure retry tests, live recovery, no-IdP startup and network-none schema generation. |
| FR-013 | Actual authentik version/resources and all live runs documented above, separate real-library fixture suites. |
| FR-014 | Begin-route/header/return allowlist tests, six common UI tests, actual multiport/subpath browser returns and loopback. |
| FR-015 | Real disabled-user A/B browser test plus local session lifecycle, zero refresh IdP requests. |
| SC-001 | Offline imported production multiport AIO chain. |
| SC-002 | Default/global/basic/post/UserInfo/false/missing, real CA positive/negative, explicit/default-rejected HTTP. |
| SC-003 / SC-004 | Transaction/identity concurrency and negative protocol suites, stable repeated identity and email conflict assertions. |
| SC-005 | Upgrade snapshot and migrated production DB, four legacy provider fixtures, admin/second-user tests, one-button UI, actual subpath AIO. Applied to the user-approved Web scope. |
| SC-006 | Live user disablement with original session preserved and zero IdP requests on refresh. |

Post-implementation hooks: `.specify/extensions.yml` does not exist; no hooks to execute. Task statuses reflect the revised Web scope. Test configuration/credentials remain local; deployment URLs are app `http://localhost:3000`, admin `http://localhost:3000/admin`, API `http://localhost:3000/backend/v1`.


## Review fixes (2026-10-27)

The three review findings were reproduced before fixing them:

1. Four deterministic database tests failed for legacy-first and OIDC-first interleavings, including case-equivalent emails. Google and magic-link could both succeed or leave both methods associated with the same OIDC user.
2. The actual old admin bundle's failed-save Axios logger retained the synthetic OIDC client secret. The browser regression inspected serialized console arguments and failed on that retained request body; no live credential was used or printed.
3. Both false/true deletion-event cases failed against the actual GraphQL schema with `Cannot return null for non-nullable field User.emailVerified`.

Fixes: all three OAuth strategies now delegate legacy local-user resolution to one AuthService path. It holds the same canonical-email PostgreSQL transaction lock used by OIDC through the boundary check, user lookup, profile completion and Account creation. Magic-link user creation and provider association use that boundary too. The transaction client is passed to all UserService reads/writes; email delivery and local JWT generation remain outside the lock. A failure rolls back local association/profile writes. Existing legacy associations and local token semantics are retained.

The onboarding request helper now propagates failure to the form instead of printing the full AxiosError and returning null. The form logs a constant diagnostic, displays its existing error toast and releases the saving state. Deletion events now include the stored emailVerified boolean.

Validation: all six new database/GraphQL regression cases pass; the complete OIDC e2e directory passes 29 tests / 9 suites. The affected unit set passes 142 tests / 9 suites. The rebuilt admin UI's real-browser failed save logs no request credential, then succeeds on corrected retry and completes app/admin login, second-user authorization, refresh/logout and loopback; 17 Me requests include emailVerified, with zero outside-allowlist browser requests. Official backend and admin production builds pass, focused OIDC/regression ESLint and git diff whitespace checks pass. No schema or dependency change was required for these fixes.

The earlier AIO image ID above records the initial acceptance build. The review-fixed isolated image is `sha256:2864f8054d68d6026e0f72d5e641288995d56da0aa4e80cdf604029cbdddf3b2`. The ignored offline archive was refreshed and the isolated AIO container was replaced with pull disabled, retaining the upgrade database and existing internal-only network. A 6656 MiB frontend heap exhausted available Docker memory during this refresh; only the test AIO was temporarily stopped, and a 6144 MiB heap build then succeeded. Business containers were not stopped. Runtime readiness returned OIDC only; the subsequent real authentik Web/admin browser result is recorded below.


The review-fixed production AIO also passed a fresh real authentik global/post/UserInfo Web/admin login, local refresh/logout and device-login/loopback run on the existing subpath deployment. The browser observed 11 Me requests with emailVerified, retained false, and attempted zero requests outside the allowed hosts. The failed-save secret regression remains covered separately by the fixture browser run with synthetic credentials. The current test deployment and ignored offline archive now contain the fixes.


## Second review fixes (2026-10-27)

Both findings were reproduced before their fixes. Production DTO transformation creates own properties with undefined values for omitted optional fields; spreading those properties over defaults made minimal OIDC onboarding return 400. The shared configuration parser now ignores undefined inputs while retaining validation of explicit blanks. The e2e application uses the same transform/whitelist/forbidNonWhitelisted ValidationPipe as production. A minimal HTTPS configuration persists the three defaults without discovery; all three explicitly blank options still return 400 without changing configuration.

Actual HTTP 500/503 responses at token, JWKS and UserInfo previously became 401 authentication failures. The adapter now discards upstream server-error bodies and returns the stable 503 OIDC_PROVIDER_UNAVAILABLE response. Genuine upstream authentication rejection remains 401. Eight real-library regressions cover the three endpoints, discovery failure-cache expiry, recovery and the preserved 401. A REST regression additionally proves that a failed new login creates no User/Account or local token cookies, an existing local session still verifies and refreshes without an IdP request, and a subsequent login succeeds after recovery.

Validation: backend production build PASS; 143 unit tests / 9 suites PASS; 34 OIDC e2e tests / 10 suites PASS, including the actual Chrome app/admin workflow and second user; 41 real-library tests PASS on production Node 24 with container egress disabled. No schema or dependency change is needed.

Focused TypeScript ESLint, JavaScript fixture syntax checks, formatting and git diff whitespace checks pass. The rebuilt production AIO is `sha256:2dc83e57ba2eb44e251e28bafd6617b2420a0ffd0b51847a8b35343c9dd5104d` (6144 MiB frontend heap). The isolated container and ignored offline archive now use this image, retaining the upgrade database and internal-only network. The real authentik global issuer / independent discovery / post / UserInfo subpath browser run passed app/admin login, local refresh/logout and device-login/loopback verification: 11 Me queries carried emailVerified=false, and outside-allowlist browser requests were zero. Onboarding failure/retry and the second-user assertions are covered by the separate fixture browser e2e, rather than repeated against this already configured live deployment.

Final credential scan: 2570 Git-visible files and 80 acceptance logs (including the replacement AIO runtime log), zero live credential/key matches. Local credential files and the refreshed image archive remain ignored.


## Browser interaction review fixes (2026-10-28)

The review reproduced two interaction defects: OIDC failure left the browser on a raw JSON document without recovery controls, and onboarding's two OIDC selects displayed only raw method/boolean values with no visible labels.

An exception filter scoped to the two OIDC routes now renders a standalone English/Chinese error page for explicit HTML navigations, preserving the original status. It needs no scripts, fonts or external resources. Fixed messages and HTML-escaped configured links prevent reflecting upstream diagnostics or callback parameters. Returns are restricted to configured allowlisted app/admin bases. Retry uses the configured API base (including subpaths), retains the server-validated entry when available, and begins a fresh transaction. Disabled sign-in offers return links without a retry loop. Default/wildcard/JSON-preferred clients keep Nest JSON responses. Existing local access/refresh cookies are retained.

Onboarding now gives the authentication and insecure-HTTP selects associated visible labels, explanatory help and translated option names. Settings uses the same translated option names. Normal HTTPS remains the default. Actual Vue rendering verified the English and Chinese labels and HTTPS option, not just locale-file contents.

Validation: official backend/admin builds PASS; 147 affected unit tests / 10 suites PASS; 41 real-library tests PASS on Node 24 with container egress disabled. Six additional HTTP cases cover cancellation, Chinese invalid-state text, untrusted query/forwarded host rejection, token 503 recovery with an existing session, conflict admission, JSON negotiation and subpath discovery failure. The real Chrome workflow clicks both app/admin return links, encounters another failure, then clicks retry and completes sign-in. It also passes failed-save secret protection, second-user privileges, true/false verification, local refresh/logout and device loopback. Its evidence has 20 Me requests carrying emailVerified and zero outside-allowlist browser requests.

The first local admin build lacked the explicit fixture URLs after the host .env was absent; it was rebuilt with VITE values from .env.example. Browser language is now explicitly negotiated so its English and Chinese checks do not depend on the host language. Focused OIDC TypeScript ESLint and formatting checks pass. The broader auth.controller.ts lint still reports six pre-existing unused-argument/empty-body errors in the three legacy Passport initiation handlers; those handlers were not changed. Previously documented unrelated frontend typecheck failures remain outside this fix.

Final complete OIDC e2e rerun: 40 tests / 11 suites PASS, including all new error/retry interactions and the existing browser, concurrency and upgrade cases. The final select styling also constrains long translated option names on narrow viewports.

The production AIO build passed with a 6144 MiB frontend heap. Warm builder stages now use cache-only export to avoid retaining more intermediate images. Docker storage filled during deployment and the isolated PostgreSQL could not complete recovery. The first replacement automatically rolled back. Six untagged builder images were matched to this task's previous build logs and working directories, then removed without force; no database volume, unrelated image or business container was removed. About 8 GiB became available and PostgreSQL recovered automatically. A second replacement passed readiness and actual deployed English/Chinese HTML error-page checks, including subpath retry URLs and no reflection of supplied vendor diagnostics.

Current isolated production image: `sha256:f2ccf3ea4412381f062c6b70cd1316864a171bf496ed5f42239a67f6565aed04`. The ignored offline archive contains the same image; credentials and the migrated test database are retained.

The replacement production AIO then passed real authentik global issuer / independent discovery / post / UserInfo Web/admin login, local refresh/logout and device-loopback verification. It observed 11 Me queries with emailVerified=false and zero outside-allowlist browser requests. Failure-page return/retry clicks and bilingual onboarding controls remain covered by the separate 20-Me fixture browser run; they were not repeated against the already configured live onboarding. The test deployment and ignored offline archive both contain the fixed image.

Final scan: 2573 Git-visible files and 96 acceptance logs including the replacement runtime/startup logs; zero known live credential/key matches. Credentials and the refreshed offline archive remain ignored.
