import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { startProvider } from '../fixtures/provider.mjs';
const require = createRequire(import.meta.url);
const {
  OIDCClientAdapter,
} = require('../../../dist/src/auth/oidc/oidc-client.adapter.js');
const baseFetch = globalThis.fetch;
let networkRequests = 0,
  denyEgress = false;
const live = process.env.OIDC_LIVE_AUTHENTIK_FILE
  ? JSON.parse(readFileSync(process.env.OIDC_LIVE_AUTHENTIK_FILE, 'utf8'))
  : null;
const allowed = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  ...(live ? [new URL(live.issuer).hostname] : []),
]);
globalThis.fetch = (...args) => {
  const input = args[0];
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (denyEgress || !allowed.has(url.hostname))
    throw new Error('OIDC_TEST_EGRESS_BLOCKED');
  networkRequests++;
  return baseFetch(...args);
};
const provider = await startProvider();
const adapter = new OIDCClientAdapter();
process.send({ ready: true, issuer: provider.issuer });
process.on('message', async ({ id, action, args }) => {
  try {
    let value;
    if (action === 'authorize')
      value = (
        await adapter.authorizationUrl(args.config, args.context, args.state)
      ).href;
    else if (action === 'callback')
      value = await adapter.callback(
        args.config,
        args.context,
        new URL(args.url),
        args.state,
      );
    else if (action === 'controls') {
      Object.assign(provider.controls, args);
      value = true;
    } else if (action === 'egress') {
      denyEgress = args.blocked === true;
      value = true;
    } else if (action === 'counts')
      value = { ...provider.counts, networkRequests };
    else throw new Error('Unknown protocol harness command');
    process.send({ id, value });
  } catch (error) {
    process.send({
      id,
      error: error.message,
      status: error.getStatus?.() ?? 500,
    });
  }
});
process.on('disconnect', async () => {
  await provider.close();
  process.exit(0);
});
