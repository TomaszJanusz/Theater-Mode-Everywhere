import assert from 'node:assert/strict';
import net from 'node:net';

// Firefox's RDP API, also used by Mozilla web-ext, installs an actual temporary
// addon. Only the isolated test profile enables its loopback debugger server.
// https://github.com/mozilla/web-ext/blob/master/src/firefox/remote.js
export async function debuggerPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
export async function installFirefoxAddon(port, addonPath) {
  const socket = await new Promise((resolve, reject) => {
    const connection = net.connect(port, '127.0.0.1', () => resolve(connection));
    connection.once('error', reject);
  });
  let buffer = Buffer.alloc(0);
  const packets = [];
  let pending;
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const delimiter = buffer.indexOf(':');
      if (delimiter < 0) return;
      const length = Number(buffer.subarray(0, delimiter).toString());
      if (buffer.length < delimiter + 1 + length) return;
      const packet = JSON.parse(buffer.subarray(delimiter + 1, delimiter + 1 + length));
      buffer = buffer.subarray(delimiter + 1 + length);
      if (pending) { const resolve = pending; pending = undefined; resolve(packet); }
      else packets.push(packet);
    }
  });
  const next = () => new Promise((resolve, reject) => {
    if (packets.length) return resolve(packets.shift());
    const timer = setTimeout(() => { pending = undefined; reject(new Error('Firefox RDP timeout')); }, 10000);
    pending = packet => { clearTimeout(timer); resolve(packet); };
  });
  const request = message => {
    const payload = JSON.stringify(message);
    socket.write(`${Buffer.byteLength(payload)}:${payload}`);
    return next();
  };
  try {
    await next(); // Connection greeting.
    const root = await request({ to: 'root', type: 'getRoot' });
    assert.ok(root.addonsActor, JSON.stringify(root));
    const result = await request({ to: root.addonsActor, type: 'installTemporaryAddon', addonPath, openDevTools: false });
    assert.equal(result.addon?.id, 'theater-everywhere@tomaszjanusz.dev', JSON.stringify(result));
    return result.addon.id;
  } finally { socket.destroy(); }
}
