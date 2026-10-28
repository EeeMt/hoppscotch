import assert from 'node:assert/strict';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function checkSettings({
  send,
  evaluate,
  until,
  live,
  apiBase,
  adminBase,
  preparePendingAuthorization,
}) {
  const gqlUrl = apiBase.replace(/\/v1$/, '/graphql');
  const gql = async (query, variables = {}) => {
    const result = await evaluate(
      `fetch(${JSON.stringify(gqlUrl)},{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify({ query, variables }))}}).then(r=>r.json())`,
    );
    if (result.errors)
      throw new Error('Guarded admin configuration operation failed');
    return result.data;
  };
  const configQuery =
    'query { infraConfigs(configNames:[OIDC_CLIENT_SECRET,OIDC_SCOPE,OIDC_CALLBACK_URL]) { name value } }';
  const before = await gql(configQuery);
  const oldSecret = before.infraConfigs.find(
    (x) => x.name === 'OIDC_CLIENT_SECRET',
  ).value;
  assert.equal(oldSecret, live.clientSecret);
  const pendingState = await preparePendingAuthorization();
  await send('Page.navigate', { url: adminBase + '/settings' });
  await until(
    `document.querySelectorAll('input').length>0 || location.pathname.endsWith('/setup')`,
    'settings or first-admin setup',
  );
  if (await evaluate(`location.pathname.endsWith('/setup')`)) {
    await until(
      `!![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Continue to Dashboard')`,
      'first-admin setup',
    );
    await evaluate(
      `(() => { for(const toggle of [...document.querySelectorAll('.toggle.on')]) toggle.closest('[tabindex="0"]').click(); [...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Continue to Dashboard').click(); })()`,
    );
    await until(
      `location.pathname.endsWith('/dashboard')`,
      'first-admin setup without analytics/newsletter',
    );
    await send('Page.navigate', { url: adminBase + '/settings' });
  }

  try {
    await until(
      `!![...document.querySelectorAll('input')].find(x=>x.value===${JSON.stringify(live.issuer)})`,
      'OIDC settings fields',
    );
  } catch {
    const diagnostic = await evaluate(
      `({path:location.pathname,headings:[...document.querySelectorAll('h1,h2,h3')].map(x=>x.textContent.trim()),labels:[...document.querySelectorAll('label')].map(x=>x.textContent.trim()),buttons:[...document.querySelectorAll('button')].map(x=>x.textContent.trim()).filter(Boolean),loadError:document.body.innerText.includes('Failed to load'),inputs:document.querySelectorAll('input').length})`,
    );
    throw new Error(
      'OIDC settings page unavailable: ' + JSON.stringify(diagnostic),
    );
  }
  assert.equal(
    await evaluate(
      `(() => {const inputs=[...document.querySelectorAll('input')]; return inputs.some(x=>x.disabled&&x.value===${JSON.stringify(apiBase + '/auth/oidc/callback')})&&inputs.some(x=>x.type==='password'&&x.value===${JSON.stringify(live.clientSecret)});})()`,
    ),
    true,
  );
  await evaluate(
    `(() => { const input=[...document.querySelectorAll('input')].find(x=>x.value==='openid,profile,email'); input.value='openid,email,profile'; input.dispatchEvent(new Event('input',{bubbles:true})); const proxy=[...document.querySelectorAll('input')].find(x=>x.placeholder?.toLowerCase().includes('proxy')); if(proxy && !proxy.value) {proxy.value=${JSON.stringify(new URL(apiBase).origin + '/internal-proxy')};proxy.dispatchEvent(new Event('input',{bubbles:true}));} })()`,
  );
  await until(
    `!![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Save Changes')`,
    'settings save',
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Save Changes').click()`,
  );
  await until(
    `!![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Yes')`,
    'settings confirmation',
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Yes').click()`,
  );
  await delay(8000);
  await until(
    `fetch(${JSON.stringify(apiBase + '/auth/providers')}).then(r=>r.json()).then(r=>r.providers?.includes('OIDC')).catch(()=>false)`,
    'settings restart',
  );
  const after = await gql(configQuery);
  assert.equal(
    after.infraConfigs.find((x) => x.name === 'OIDC_SCOPE').value,
    'openid,email,profile',
  );
  assert.equal(
    after.infraConfigs.find((x) => x.name === 'OIDC_CLIENT_SECRET').value,
    oldSecret,
  );
  assert.equal(
    await evaluate(
      `fetch(${JSON.stringify(apiBase + '/auth/oidc/callback?code=unused&state=' + pendingState)},{credentials:'include'}).then(r=>r.status)`,
    ),
    400,
  );

  // A separate dummy legacy option avoids violating the existing at-least-one
  // provider rule. It never authorizes with Google or performs external fetches.
  await gql(
    'mutation($infraConfigs:[InfraConfigArgs!]!) { updateInfraConfigs(infraConfigs:$infraConfigs) { name } }',
    {
      infraConfigs: [
        { name: 'GOOGLE_CLIENT_ID', value: 'isolated-unused-client' },
        { name: 'GOOGLE_CLIENT_SECRET', value: 'isolated-unused-secret' },
        {
          name: 'GOOGLE_CALLBACK_URL',
          value: apiBase + '/auth/google/callback',
        },
        { name: 'GOOGLE_SCOPE', value: 'email,profile' },
      ],
    },
  );
  const toggle =
    'mutation($providerInfo:[EnableAndDisableSSOArgs!]!) { enableAndDisableSSO(providerInfo:$providerInfo) }';
  await gql(toggle, {
    providerInfo: [
      { provider: 'OIDC', status: 'DISABLE' },
      { provider: 'GOOGLE', status: 'ENABLE' },
    ],
  });
  await delay(8000);
  await until(
    `fetch(${JSON.stringify(apiBase + '/auth/providers')}).then(r=>r.json()).then(r=>r.providers?.includes('GOOGLE')&&!r.providers.includes('OIDC')).catch(()=>false)`,
    'disabled OIDC after restart',
  );
  assert.equal(
    await evaluate(
      `fetch(${JSON.stringify(apiBase + '/auth/oidc')},{credentials:'include'}).then(r=>r.status)`,
    ),
    404,
  );
  assert.equal(
    await evaluate(
      `fetch(${JSON.stringify(apiBase + '/auth/oidc/callback?code=unused&state=' + pendingState)},{credentials:'include'}).then(r=>r.status)`,
    ),
    404,
  );
  assert.equal(
    await evaluate(
      `fetch(${JSON.stringify(apiBase + '/auth/refresh')},{credentials:'include'}).then(r=>r.status)`,
    ),
    200,
  );
  assert.equal(
    (await gql(configQuery)).infraConfigs.find(
      (x) => x.name === 'OIDC_CLIENT_SECRET',
    ).value,
    oldSecret,
  );
  await gql(toggle, {
    providerInfo: [
      { provider: 'OIDC', status: 'ENABLE' },
      { provider: 'GOOGLE', status: 'DISABLE' },
    ],
  });
  await delay(8000);
  await until(
    `fetch(${JSON.stringify(apiBase + '/auth/providers')}).then(r=>r.json()).then(r=>r.providers?.includes('OIDC')&&!r.providers.includes('GOOGLE')).catch(()=>false)`,
    're-enabled OIDC after restart',
  );
  assert.equal(
    (await gql(configQuery)).infraConfigs.find(
      (x) => x.name === 'OIDC_CLIENT_SECRET',
    ).value,
    oldSecret,
  );
  return {
    settingsSave: true,
    maskedSecret: true,
    derivedCallback: true,
    fingerprintInvalidated: true,
    disableEnable: true,
    secretPreserved: true,
    localSessionPreserved: true,
  };
}
