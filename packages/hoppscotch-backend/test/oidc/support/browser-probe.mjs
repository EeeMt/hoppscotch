import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { checkSettings } from './settings-acceptance.mjs';

const directory = mkdtempSync(join(tmpdir(), 'hopp-oidc-browser-'));
const chrome = spawn(
  process.env.OIDC_CHROME_PATH,
  [
    '--headless=new',
    ...(process.getuid?.() === 0
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${directory}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const live = process.env.OIDC_LIVE_AUTHENTIK_FILE
  ? JSON.parse(readFileSync(process.env.OIDC_LIVE_AUTHENTIK_FILE, 'utf8'))
  : null;
const appBase = (live?.appUrl || 'http://localhost:3000').replace(/\/+$/, '');
const adminBase = (live?.adminUrl || 'http://localhost:3100').replace(
  /\/+$/,
  '',
);
const apiBase = (live?.apiUrl || 'http://localhost:3170/v1').replace(
  /\/+$/,
  '',
);
let socket,
  liveUserDisabled = false;
const setTestUserActive = (active) => {
  const code = `from authentik.core.models import User; user=User.objects.get(pk=${Number(live.resources.user)},username=${JSON.stringify(live.username)}); user.is_active=${active ? 'True' : 'False'}; user.save(update_fields=['is_active'])`;
  execFileSync(
    'docker',
    [
      'exec',
      '-e',
      'AUTHENTIK_LOG_LEVEL=error',
      'authentik-server-1',
      'ak',
      'shell',
      '-c',
      code,
    ],
    { stdio: 'ignore' },
  );
};
try {
  for (
    let i = 0;
    i < 100 && !existsSync(join(directory, 'DevToolsActivePort'));
    i++
  )
    await delay(100);
  let port;
  for (let i = 0; i < 100; i++) {
    port = readFileSync(join(directory, 'DevToolsActivePort'), 'utf8').split(
      '\n',
    )[0];
    if (/^[1-9][0-9]+$/.test(port)) break;
    await delay(50);
  }
  assert.match(port, /^[1-9][0-9]+$/);
  const page = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: 'PUT',
    })
  ).json();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0,
    blocked = 0,
    meWithVerified = 0;
  let certificateRejected = false,
    idpRejected = false;
  let holdNextAuthorization = false,
    pendingAuthorizationState,
    settingsEvidence;
  let onboardingLogInspected = false,
    onboardingSecretLogged = false;
  const flowResponses = new Set();
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error)
        entry?.reject(new Error('Browser protocol command failed'));
      else entry?.resolve(message.result);
    }
    if (
      !live &&
      message.method === 'Runtime.consoleAPICalled' &&
      message.params.type === 'error'
    ) {
      for (const argument of message.params.args) {
        let value = String(argument.value || argument.description || '');
        if (argument.objectId) {
          try {
            const serialized = await send('Runtime.callFunctionOn', {
              objectId: argument.objectId,
              functionDeclaration:
                'function() { return JSON.stringify(this); }',
              returnByValue: true,
            });
            value += serialized.result.value || '';
          } catch {}
        }
        if (value.includes('fixture-secret')) onboardingSecretLogged = true;
        if (
          value.includes('AxiosError') ||
          value.includes('Failed to add onboarding configs')
        )
          onboardingLogInspected = true;
      }
    }
    if (message.method === 'Fetch.requestPaused') {
      const p = message.params;
      const url = new URL(p.request.url);
      if (
        holdNextAuthorization &&
        live &&
        url.hostname === new URL(live.issuer).hostname &&
        url.searchParams.has('client_id') &&
        url.searchParams.has('state')
      ) {
        pendingAuthorizationState = url.searchParams.get('state');
        holdNextAuthorization = false;
        await send('Fetch.failRequest', {
          requestId: p.requestId,
          errorReason: 'Aborted',
        });
        return;
      }
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        ![
          'localhost',
          '127.0.0.1',
          '[::1]',
          ...(live ? [new URL(live.issuer).hostname] : []),
        ].includes(url.hostname)
      ) {
        blocked++;
        await send('Fetch.failRequest', {
          requestId: p.requestId,
          errorReason: 'BlockedByClient',
        });
      } else await send('Fetch.continueRequest', { requestId: p.requestId });
    }
    if (
      message.method === 'Network.responseReceived' &&
      message.params.response.url.includes('/api/v3/flows/executor/')
    )
      flowResponses.add(message.params.requestId);
    if (
      message.method === 'Network.loadingFinished' &&
      flowResponses.has(message.params.requestId)
    ) {
      try {
        const response = await send('Network.getResponseBody', {
          requestId: message.params.requestId,
        });
        const value = JSON.parse(response.body);
        if (value.response_errors && Object.keys(value.response_errors).length)
          idpRejected = true;
      } catch {}
    }
    if (
      message.method === 'Network.loadingFailed' &&
      message.params.errorText?.includes('ERR_CERT_AUTHORITY_INVALID')
    )
      certificateRejected = true;
    if (message.method === 'Network.requestWillBeSent') {
      const request = message.params.request;
      if (
        request.url.endsWith('/graphql') &&
        request.postData?.includes('emailVerified')
      )
        meWithVerified++;
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', {
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error('Browser evaluation failed');
    return result.result.value;
  };
  const controls = async (value) => {
    assert.equal(live, null);
    const response = await fetch(
      `http://localhost:${process.env.OIDC_LOOPBACK_PORT}/controls`,
      {
        method: 'POST',
        body: JSON.stringify(value),
      },
    );
    assert.equal(response.status, 200);
  };
  let appErrorRecovery = false,
    adminErrorRecovery = false,
    onboardingSelectLabels = false;
  const until = async (expression, label) => {
    for (let i = 0; i < 120; i++) {
      try {
        if (await evaluate(expression)) return;
      } catch {}
      await delay(250);
    }
    throw new Error('Timed out: ' + label);
  };
  const authenticate = async () => {
    if (!live) return;
    let identified = false,
      passwordSent = false,
      seen = false;
    const deep = `(function all(root=document) { const result=[...root.querySelectorAll('*')]; return result.flatMap(e => [e,...(e.shadowRoot?all(e.shadowRoot):[])]); })().filter(e => { const r=e.getBoundingClientRect(); return r.width>10 && r.height>10 && r.bottom>0 && r.right>0 && r.top<innerHeight && r.left<innerWidth && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).opacity!=='0' })`;
    for (let i = 0; i < 80; i++) {
      if (
        process.env.OIDC_EXPECT_IDP_REJECTION === '1' &&
        idpRejected &&
        (identified || passwordSent)
      )
        return;
      const host = await evaluate('location.host').catch(() => '');
      if (host === new URL(live.issuer).host) {
        seen = true;
        const stage = await evaluate(
          `(() => { const elements=${deep}; return elements.some(e=>e.tagName==='AK-STAGE-CONSENT')?'consent':elements.some(e=>e.tagName==='INPUT'&&e.name==='uidField')?'username':elements.some(e=>e.tagName==='INPUT'&&e.name==='password')?'password':'' })()`,
        );
        if (stage === 'consent') {
          // Consent actions may be below the viewport. Use authentik's own
          // cancellation link: this version cancels the flow without an OAuth error redirect.
          const action = await evaluate(
            `(() => { const e=(function all(root=document) { return [...root.querySelectorAll('*')].flatMap(x=>[x,...(x.shadowRoot?all(x.shadowRoot):[])]); })(); const target=${process.env.OIDC_EXPECT_IDP_CANCELLATION === '1' ? "e.find(x=>x.tagName==='A'&&x.getAttribute('href')?.includes('/flows/-/cancel/'))" : "e.find(x=>x.tagName==='BUTTON'&&x.name==='continue')"}; if(!target) return false; target.scrollIntoView(); target.click(); return true; })()`,
          );
          if (action && process.env.OIDC_EXPECT_IDP_CANCELLATION === '1')
            return;
        } else if (stage === 'username' && !identified) {
          // authentik supports both a combined form and separate password stage.
          passwordSent = await evaluate(
            `(() => { const e=${deep}; const input=e.find(x=>x.tagName==='INPUT'&&x.name==='uidField'); input.value=${JSON.stringify(live.username)}; input.dispatchEvent(new Event('input',{bubbles:true,composed:true})); const password=e.find(x=>x.tagName==='INPUT'&&x.name==='password'); if(password){password.value=${JSON.stringify(live.password)}; password.dispatchEvent(new Event('input',{bubbles:true,composed:true}));} (input.closest('form')?.querySelector('button[type=submit]') || e.find(x=>x.tagName==='BUTTON'&&x.type==='submit')).click(); return Boolean(password); })()`,
          );
          identified = true;
        } else if (stage === 'password' && !passwordSent) {
          await evaluate(
            `(() => { const e=${deep}; const input=e.find(x=>x.tagName==='INPUT'&&x.name==='password'); input.value=${JSON.stringify(live.password)}; input.dispatchEvent(new Event('input',{bubbles:true,composed:true})); (input.closest('form')?.querySelector('button[type=submit]') || e.find(x=>x.tagName==='BUTTON'&&x.type==='submit')).click(); })()`,
          );
          passwordSent = true;
        } else if (passwordSent && !stage) {
          await evaluate(
            `(() => { const e=${deep}; if(e.some(x=>x.tagName==='AK-STAGE-USER-LOGIN')) e.find(x=>x.tagName==='BUTTON'&&['No','否'].includes(x.textContent.trim()))?.click(); })()`,
          );
        }
      } else if (seen || i > 20) return;
      await delay(250);
    }
    const diagnostic = await evaluate(
      `(() => { const e=${deep}; return {path:location.pathname, inputs:e.filter(x=>x.tagName==='INPUT').map(x=>({name:x.name,type:x.type})), headings:e.filter(x=>['H1','H2'].includes(x.tagName)).map(x=>x.textContent.trim().slice(0,80)), stages:e.filter(x=>x.tagName.startsWith('AK-STAGE')).map(x=>x.tagName), buttons:e.filter(x=>x.tagName==='BUTTON').map(x=>x.textContent.trim().slice(0,80))} })()`,
    );
    throw new Error(
      'Timed out authenticating test user: ' +
        JSON.stringify({ diagnostic, identified, passwordSent, blocked }),
    );
  };
  if (process.env.OIDC_EXPECT_SECOND_USER === '1') {
    await send('Page.navigate', { url: apiBase + '/auth/oidc' });
    await until(
      `(() => { const value=JSON.parse(localStorage.getItem('persistence.v1:login_state') || 'null')?.json?.data; const user=typeof value==='string'?JSON.parse(value):value; return !!user?.uid && user.emailVerified === true })()`,
      'verified second user app state',
    );
    const permissions = await evaluate(
      `fetch(${JSON.stringify(apiBase + '/auth/verify/admin')},{credentials:'include'}).then(r=>r.json())`,
    );
    assert.equal(permissions.isAdmin, false);
    throw new Error('OIDC_EXPECTED_SECOND_USER');
  }
  if (process.env.OIDC_EXPECT_IDP_CANCELLATION === '1') {
    await send('Page.navigate', { url: apiBase + '/auth/oidc' });
    await authenticate();
    await until(
      `!location.pathname.includes('default-provider-authorization-explicit-consent')`,
      'cancelled authentik flow',
    );
    const { cookies } = await send('Network.getCookies', {
      urls: [apiBase + '/auth/refresh'],
    });
    assert.equal(
      cookies.some((c) => ['access_token', 'refresh_token'].includes(c.name)),
      false,
    );
    throw new Error('OIDC_EXPECTED_IDP_CANCELLATION');
  }
  if (process.env.OIDC_EXPECT_PROVIDER_UNAVAILABLE === '1') {
    await send('Page.navigate', { url: apiBase + '/auth/oidc' });
    await authenticate();
    await until(
      `document.body.innerText.includes('OIDC_PROVIDER_UNAVAILABLE')`,
      'controlled provider unavailability',
    );
    const { cookies } = await send('Network.getCookies', {
      urls: [apiBase + '/auth/refresh'],
    });
    assert.equal(
      cookies.some((c) => ['access_token', 'refresh_token'].includes(c.name)),
      false,
    );
    throw new Error('OIDC_EXPECTED_PROVIDER_UNAVAILABLE');
  }
  if (process.env.OIDC_EXPECT_IDP_REJECTION === '1') {
    await send('Page.navigate', { url: apiBase + '/auth/oidc' });
    await authenticate();
    assert.equal(idpRejected, true);
    const { cookies } = await send('Network.getCookies', {
      urls: [apiBase + '/auth/refresh'],
    });
    assert.equal(
      cookies.some((c) => ['access_token', 'refresh_token'].includes(c.name)),
      false,
    );
    throw new Error('OIDC_EXPECTED_IDP_REJECTION');
  }
  if (process.env.OIDC_SKIP_ONBOARDING !== '1') {
    await send('Page.navigate', { url: adminBase + '/onboarding?step=2' });
    await until(
      `!![...document.querySelectorAll('span')].find(b => b.textContent.trim() === 'OAuth')`,
      'onboarding OAuth card',
    );
    await evaluate(
      `[...document.querySelectorAll('span')].find(b => b.textContent.trim() === 'OAuth').click()`,
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add Auth Configurations').click()`,
    );
    await until(
      `!![...document.querySelectorAll('span')].find(b => b.textContent.trim() === 'OpenID Connect')`,
      'onboarding OIDC provider',
    );
    await evaluate(
      `[...document.querySelectorAll('span')].find(b => b.textContent.trim() === 'OpenID Connect').closest('div').querySelector('[tabindex="0"]').click()`,
    );
    await until(
      `!![...document.querySelectorAll('label')].find(b => b.textContent.trim() === 'Oidc Issuer')`,
      'OIDC configuration form',
    );
    await evaluate(`(() => {
    const fields = {'Oidc Issuer': ${JSON.stringify(process.env.OIDC_FIXTURE_ISSUER)}, 'Oidc Discovery Url': ${JSON.stringify(live?.useDiscoveryUrl ? live.discoveryUrl : '')}, 'Oidc Client Id': ${JSON.stringify(live?.clientId || 'fixture-client')}, 'Oidc Client Secret': ${JSON.stringify(live?.clientSecret || 'fixture-secret')}};
    for (const [label, value] of Object.entries(fields)) {
      const element = [...document.querySelectorAll('label')].find(e => e.textContent.trim() === label);
      const input = document.getElementById(element.htmlFor); input.value = value; input.dispatchEvent(new Event('input', {bubbles:true}));
    }
    const method = document.getElementById('OIDC_TOKEN_ENDPOINT_AUTH_METHOD'); method.value = ${JSON.stringify(live?.authMethod || 'client_secret_basic')}; method.dispatchEvent(new Event('change', {bubbles:true}));
    const http = document.getElementById('OIDC_ALLOW_INSECURE_HTTP'); http.value = ${JSON.stringify(live && !live.issuer.startsWith('http:') ? 'false' : 'true')}; http.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
    onboardingSelectLabels = await evaluate(`(() => {
      const method=document.getElementById('OIDC_TOKEN_ENDPOINT_AUTH_METHOD'), http=document.getElementById('OIDC_ALLOW_INSECURE_HTTP');
      return method.labels[0].textContent.includes('Token Endpoint Authentication') && http.labels[0].textContent.includes('Allow Insecure HTTP') &&
        http.options[0].text.includes('Require HTTPS') && http.options[1].text.includes('insecure') &&
        !!document.getElementById(http.getAttribute('aria-describedby'))?.textContent.trim();
    })()`);
    assert.equal(onboardingSelectLabels, true);
    await evaluate(
      `document.getElementById('app').__vue_app__.config.globalProperties.$i18n.locale = 'cn'`,
    );
    await until(
      `document.querySelector('label[for="OIDC_ALLOW_INSECURE_HTTP"]').textContent.includes('允许不安全的 HTTP')`,
      'Chinese OIDC control labels',
    );
    assert.equal(
      await evaluate(
        `document.getElementById('OIDC_ALLOW_INSECURE_HTTP').options[0].text.includes('要求 HTTPS') && document.querySelector('label[for="OIDC_TOKEN_ENDPOINT_AUTH_METHOD"]').textContent.includes('认证方式')`,
      ),
      true,
    );
    await evaluate(
      `document.getElementById('app').__vue_app__.config.globalProperties.$i18n.locale = 'en'`,
    );
    await until(
      `document.querySelector('label[for="OIDC_ALLOW_INSECURE_HTTP"]').textContent.includes('Allow Insecure HTTP')`,
      'English OIDC control labels',
    );
    await delay(100);
    if (!live) {
      await evaluate(
        `(() => { const label=[...document.querySelectorAll('label')].find(x=>x.textContent.trim()==='Oidc Issuer'); const input=document.getElementById(label.htmlFor);input.value='not-an-issuer-url';input.dispatchEvent(new Event('input',{bubbles:true})); })()`,
      );
      await delay(50);
      await evaluate(
        `[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Save Auth Config').click()`,
      );
      for (let i = 0; i < 100 && !onboardingLogInspected; i++) await delay(50);
      assert.equal(
        onboardingLogInspected,
        true,
        'the failed save must exercise the error logger',
      );
      assert.equal(
        onboardingSecretLogged,
        false,
        'the error logger must not retain the request body',
      );
      await evaluate(
        `(() => { const label=[...document.querySelectorAll('label')].find(x=>x.textContent.trim()==='Oidc Issuer'); const input=document.getElementById(label.htmlFor);input.value=${JSON.stringify(process.env.OIDC_FIXTURE_ISSUER)};input.dispatchEvent(new Event('input',{bubbles:true})); })()`,
      );
      await delay(50);
    }
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save Auth Config').click()`,
    );
    await until(
      `document.body.innerText.includes('Setup Complete')`,
      'OIDC-only onboarding save',
    );
    await until(
      `fetch(${JSON.stringify(apiBase + '/auth/providers')},{credentials:'include'}).then(r=>r.json()).then(r=>r.providers?.includes('OIDC')).catch(()=>false)`,
      'configured backend after restart',
    );
  }
  await send('Page.navigate', { url: appBase });
  await until(
    `!![...document.querySelectorAll('button')].find(b => /^Login$/i.test(b.textContent.trim()))`,
    'application login button',
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => /^Login$/i.test(b.textContent.trim())).click()`,
  );
  await until(
    `document.body.innerText.includes('Continue with OpenID Connect')`,
    'OIDC login item',
  );
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('button,a')].filter(b => (b.getAttribute('aria-label') === 'Continue with OpenID Connect' || b.textContent.trim() === 'Continue with OpenID Connect')).length`,
    ),
    1,
  );
  if (!live) await controls({ httpErrors: { token: 503 } });
  await evaluate(
    `[...document.querySelectorAll('button,a')].find(b => (b.getAttribute('aria-label') === 'Continue with OpenID Connect' || b.textContent.trim() === 'Continue with OpenID Connect')).click()`,
  );
  if (!live) {
    await until(
      `!!document.getElementById('oidc-retry')`,
      'application recovery page',
    );
    assert.equal(
      await evaluate(`document.querySelector('code')?.textContent`),
      'OIDC_PROVIDER_UNAVAILABLE',
    );
    assert.equal(
      await evaluate(
        `document.body.innerText.includes('temporarily unavailable')`,
      ),
      true,
    );
    // Exercise the visible return link, then retry another failure with a fresh transaction.
    await evaluate(`document.getElementById('oidc-return-app').click()`);
    await until(
      `!![...document.querySelectorAll('button')].find(b=>/^Login$/i.test(b.textContent.trim()))`,
      'return from error to app',
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>/^Login$/i.test(b.textContent.trim())).click()`,
    );
    await until(
      `document.body.innerText.includes('Continue with OpenID Connect')`,
      'retry from app login modal',
    );
    await send('Network.setExtraHTTPHeaders', {
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    await evaluate(
      `[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()==='Continue with OpenID Connect').click()`,
    );
    await until(
      `!!document.getElementById('oidc-retry')`,
      'second application recovery page',
    );
    assert.equal(
      await evaluate(`document.body.innerText.includes('身份服务暂时不可用')`),
      true,
    );
    await controls({ httpErrors: {} });
    await send('Network.setExtraHTTPHeaders', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    await evaluate(`document.getElementById('oidc-retry').click()`);
    appErrorRecovery = true;
  }
  if (process.env.OIDC_EXPECT_BROWSER_TLS_FAILURE === '1') {
    for (let i = 0; i < 100 && !certificateRejected; i++) await delay(100);
    assert.equal(certificateRejected, true);
    const { cookies } = await send('Network.getCookies', {
      urls: [apiBase + '/auth/refresh'],
    });
    assert.equal(
      cookies.some((c) => ['access_token', 'refresh_token'].includes(c.name)),
      false,
    );
    throw new Error('OIDC_EXPECTED_BROWSER_TLS_REJECTION');
  }
  await authenticate();
  await until(
    `(() => { const raw = localStorage.getItem('persistence.v1:login_state'); if (!raw) return false; const value = JSON.parse(raw).json?.data; const user = typeof value === 'string' ? JSON.parse(value) : value; return !!user?.uid && user.emailVerified === false })()`,
    'application unverified user state',
  );
  if (process.env.OIDC_TEST_CANCELLATION === '1' && live) {
    const code = `from authentik.stages.consent.models import UserConsent; UserConsent.objects.filter(user_id=${Number(live.resources.user)},application_id=${JSON.stringify(live.resources.application)}).delete()`;
    execFileSync(
      'docker',
      [
        'exec',
        '-e',
        'AUTHENTIK_LOG_LEVEL=error',
        'authentik-server-1',
        'ak',
        'shell',
        '-c',
        code,
      ],
      { stdio: 'ignore' },
    );
    const output = execFileSync(
      process.execPath,
      [new URL('./browser-probe.mjs', import.meta.url).pathname],
      {
        env: {
          ...process.env,
          OIDC_TEST_CANCELLATION: '0',
          OIDC_EXPECT_IDP_CANCELLATION: '1',
        },
        encoding: 'utf8',
        timeout: 50000,
      },
    );
    assert.equal(JSON.parse(output).authorizationCancelled, true);
    assert.equal(
      await evaluate(
        `fetch(${JSON.stringify(apiBase + '/auth/verify-token')},{credentials:'include'}).then(r=>r.status)`,
      ),
      200,
    );
  }
  if (process.env.OIDC_TEST_RECOVERY === '1' && live) {
    const endpoint = `http://localhost:${process.env.OIDC_LOOPBACK_PORT}/egress`;
    await evaluate(
      `fetch(${JSON.stringify(endpoint + '?blocked=true')},{method:'POST'}).then(r=>r.text())`,
    );
    try {
      const output = execFileSync(
        process.execPath,
        [new URL('./browser-probe.mjs', import.meta.url).pathname],
        {
          env: {
            ...process.env,
            OIDC_TEST_RECOVERY: '0',
            OIDC_EXPECT_PROVIDER_UNAVAILABLE: '1',
          },
          encoding: 'utf8',
          timeout: 50000,
        },
      );
      assert.equal(JSON.parse(output).providerUnavailable, true);
    } finally {
      await evaluate(
        `fetch(${JSON.stringify(endpoint + '?blocked=false')},{method:'POST'}).then(r=>r.text())`,
      );
    }
  }
  if (process.env.OIDC_TEST_DISABLE_USER === '1' && live) {
    setTestUserActive(false);
    liveUserDisabled = true;
    const output = execFileSync(
      process.execPath,
      [new URL('./browser-probe.mjs', import.meta.url).pathname],
      {
        env: {
          ...process.env,
          OIDC_TEST_DISABLE_USER: '0',
          OIDC_EXPECT_IDP_REJECTION: '1',
        },
        encoding: 'utf8',
        timeout: 50000,
      },
    );
    assert.equal(JSON.parse(output).newLoginRejected, true);
    const counterUrl = `http://localhost:${process.env.OIDC_LOOPBACK_PORT}/idp-counts`;
    const before = await evaluate(
      `fetch(${JSON.stringify(counterUrl)}).then(r=>r.json())`,
    );
    assert.equal(
      await evaluate(
        `fetch(${JSON.stringify(apiBase + '/auth/verify-token')},{credentials:'include'}).then(r=>r.status)`,
      ),
      200,
    );
    assert.equal(
      await evaluate(
        `fetch(${JSON.stringify(apiBase + '/auth/refresh')},{credentials:'include'}).then(r=>r.status)`,
      ),
      200,
    );
    const after = await evaluate(
      `fetch(${JSON.stringify(counterUrl)}).then(r=>r.json())`,
    );
    assert.deepEqual(after, before);
    setTestUserActive(true);
    liveUserDisabled = false;
  }
  assert.equal(
    await evaluate(
      `fetch(${JSON.stringify(apiBase + '/auth/refresh')}, {credentials:'include'}).then(r => r.status)`,
    ),
    200,
  );
  assert.equal(
    await evaluate(
      `fetch(${JSON.stringify(apiBase + '/auth/logout')}, {credentials:'include'}).then(r => r.status)`,
    ),
    200,
  );
  await send('Page.navigate', { url: adminBase });
  await until(
    `document.body.innerText.includes('Continue with OpenID Connect')`,
    'admin OIDC login item',
  );
  if (!live) await controls({ httpErrors: { token: 503 } });
  await evaluate(
    `[...document.querySelectorAll('button,a')].find(b => (b.getAttribute('aria-label') === 'Continue with OpenID Connect' || b.textContent.trim() === 'Continue with OpenID Connect')).click()`,
  );
  if (!live) {
    await until(
      `!!document.getElementById('oidc-retry')`,
      'admin recovery page',
    );
    assert.equal(
      await evaluate(
        `new URL(document.getElementById('oidc-retry').href).searchParams.get('redirect_uri') === ${JSON.stringify(adminBase)}`,
      ),
      true,
    );
    await evaluate(`document.getElementById('oidc-return-admin').click()`);
    await until(
      `document.body.innerText.includes('Continue with OpenID Connect')`,
      'return from error to admin',
    );
    await evaluate(
      `[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()==='Continue with OpenID Connect').click()`,
    );
    await until(
      `!!document.getElementById('oidc-retry')`,
      'second admin recovery page',
    );
    await controls({ httpErrors: {} });
    await evaluate(`document.getElementById('oidc-retry').click()`);
    adminErrorRecovery = true;
  }
  await authenticate();
  await until(
    `(() => { const user = JSON.parse(localStorage.getItem('login_state') || 'null'); return user?.emailVerified === false && user?.isAdmin === true })()`,
    'admin user state and bootstrap',
  );
  if (live && process.env.OIDC_TEST_SETTINGS === '1') {
    settingsEvidence = await checkSettings({
      send,
      evaluate,
      until,
      live,
      apiBase,
      adminBase,
      preparePendingAuthorization: async () => {
        holdNextAuthorization = true;
        await send('Page.navigate', { url: apiBase + '/auth/oidc' });
        for (let i = 0; i < 100 && !pendingAuthorizationState; i++)
          await delay(100);
        assert.ok(pendingAuthorizationState);
        return pendingAuthorizationState;
      },
    });
  }
  if (!live && process.env.OIDC_TEST_SECOND_USER === '1') {
    const endpoint = `http://localhost:${process.env.OIDC_LOOPBACK_PORT}/controls`;
    const controls = async (claims) =>
      evaluate(
        `fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'text/plain'},body:${JSON.stringify(JSON.stringify({ claims }))}}).then(r=>r.text())`,
      );
    try {
      await controls({
        sub: 'browser-second',
        email: 'second@internal.example',
        name: 'Second Browser User',
        email_verified: true,
      });
      const output = execFileSync(
        process.execPath,
        [new URL('./browser-probe.mjs', import.meta.url).pathname],
        {
          env: {
            ...process.env,
            OIDC_TEST_SECOND_USER: '0',
            OIDC_EXPECT_SECOND_USER: '1',
          },
          encoding: 'utf8',
          timeout: 50000,
        },
      );
      assert.equal(JSON.parse(output).secondUserAdmin, false);
      await controls({
        sub: 'fixture-user',
        email: 'user@internal.example',
        name: 'Fixture User',
        email_verified: true,
      });
      await send('Page.navigate', {
        url:
          apiBase + '/auth/oidc?redirect_uri=' + encodeURIComponent(adminBase),
      });
      await until(
        `JSON.parse(localStorage.getItem('login_state') || 'null')?.emailVerified === true`,
        'admin verified state retained',
      );
      await send('Page.navigate', { url: appBase });
      await until(
        `(() => { const v=JSON.parse(localStorage.getItem('persistence.v1:login_state') || 'null')?.json?.data; return (typeof v==='string'?JSON.parse(v):v)?.emailVerified===true })()`,
        'app verified state retained',
      );
    } finally {
      await controls({
        sub: 'fixture-user',
        email: 'user@internal.example',
        name: 'Fixture User',
        email_verified: false,
      });
    }
  }
  await evaluate(
    `fetch(${JSON.stringify(apiBase + '/auth/logout')}, {credentials:'include'})`,
  );
  const target = `${appBase}/device-login?redirect_uri=${encodeURIComponent(`http://localhost:${process.env.OIDC_LOOPBACK_PORT}/device-token`)}`;
  await send('Page.navigate', { url: target });
  await until(
    `!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Login to Hoppscotch')`,
    'device login button',
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Login to Hoppscotch').click()`,
  );
  await until(
    `document.body.innerText.includes('Continue with OpenID Connect')`,
    'device OIDC item',
  );
  await evaluate(
    `[...document.querySelectorAll('button,a')].find(b => (b.getAttribute('aria-label') === 'Continue with OpenID Connect' || b.textContent.trim() === 'Continue with OpenID Connect')).click()`,
  );
  await authenticate();
  await until(
    `location.pathname === '/device-login' && document.body.innerText.includes('Confirm Desktop Login')`,
    'restored device confirmation',
  );
  assert.equal(
    await evaluate(`sessionStorage.getItem('oidc_device_login_return')`),
    null,
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Proceed').click()`,
  );
  await until(
    `document.body.innerText.includes('Login Complete')`,
    'existing loopback handshake',
  );
  assert.ok(meWithVerified >= 2);
  process.stdout.write(
    JSON.stringify({
      onboarding: process.env.OIDC_SKIP_ONBOARDING !== '1',
      appLogin: true,
      settingsEvidence,
      onboardingFailureSecretSafe:
        !live && onboardingLogInspected && !onboardingSecretLogged,
      adminLogin: true,
      appErrorRecovery,
      adminErrorRecovery,
      onboardingSelectLabels,
      deviceLogin: true,
      secondUserAndVerifiedStates: process.env.OIDC_TEST_SECOND_USER === '1',
      authorizationCancellation: process.env.OIDC_TEST_CANCELLATION === '1',
      providerRecovery: process.env.OIDC_TEST_RECOVERY === '1',
      idpDisableBoundary: process.env.OIDC_TEST_DISABLE_USER === '1',
      refreshIdpRequests:
        process.env.OIDC_TEST_DISABLE_USER === '1' ? 0 : undefined,
      localRefresh: true,
      localLogout: true,
      emailVerified: false,
      meWithVerified,
      blockedExternalRequests: blocked,
    }),
  );
} catch (error) {
  if (error.message === 'OIDC_EXPECTED_SECOND_USER')
    process.stdout.write(
      JSON.stringify({ emailVerified: true, secondUserAdmin: false }),
    );
  else if (error.message === 'OIDC_EXPECTED_IDP_CANCELLATION')
    process.stdout.write(
      JSON.stringify({ authorizationCancelled: true, noNewLocalSession: true }),
    );
  else if (error.message === 'OIDC_EXPECTED_PROVIDER_UNAVAILABLE')
    process.stdout.write(
      JSON.stringify({ providerUnavailable: true, noNewLocalSession: true }),
    );
  else if (error.message === 'OIDC_EXPECTED_IDP_REJECTION')
    process.stdout.write(
      JSON.stringify({ newLoginRejected: true, noNewLocalSession: true }),
    );
  else if (error.message === 'OIDC_EXPECTED_BROWSER_TLS_REJECTION')
    process.stdout.write(
      JSON.stringify({ browserTLSRejected: true, noNewLocalSession: true }),
    );
  else throw error;
} finally {
  if (liveUserDisabled) setTestUserActive(true);
  socket?.close();
  chrome.kill('SIGTERM');
  await new Promise((resolve) => chrome.once('exit', resolve));
  rmSync(directory, { recursive: true, force: true });
}
