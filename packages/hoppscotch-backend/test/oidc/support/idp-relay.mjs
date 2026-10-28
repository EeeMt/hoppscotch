// Test-only gateway. Forward encrypted traffic to one fixed IdP address/port;
// no general proxy, DNS forwarding, HTTP headers, or credential logging.
import net from 'node:net';
import http from 'node:http';
const target = process.env.OIDC_RELAY_ADDRESS;
if (!net.isIP(target))
  throw new Error('An explicitly resolved IdP IP is required');
let connections = 0,
  bytesToIdp = 0,
  bytesFromIdp = 0;
net
  .createServer((client) => {
    connections++;
    const upstream = net.connect({ host: target, port: 9999 });
    client.on('data', (b) => {
      bytesToIdp += b.length;
    });
    upstream.on('data', (b) => {
      bytesFromIdp += b.length;
    });
    client.pipe(upstream).pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  })
  .listen(9999, '0.0.0.0');
http
  .createServer((req, res) => {
    if (req.url !== '/counts') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ connections, bytesToIdp, bytesFromIdp }));
  })
  .listen(9099, '0.0.0.0');
