// Test-only incoming port gateway; the AIO remains on an internal-only network.
import net from 'node:net';
for (const port of [3000, 3100, 3170]) {
  net
    .createServer((client) => {
      const upstream = net.connect({ host: 'hoppscotch-oidc-aio', port });
      client.pipe(upstream).pipe(client);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    })
    .listen(port, '0.0.0.0');
}
