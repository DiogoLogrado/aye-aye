import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startServer } from '../server/start';

const tmpDirs: string[] = [];
const tmp = async (prefix: string) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
after(() => Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true }))));

describe('startServer', () => {
  let clientDir: string;
  let dataDir: string;

  before(async () => {
    clientDir = await tmp('aye-aye-client-');
    dataDir = await tmp('aye-aye-data-');
    await fs.writeFile(
      path.join(clientDir, 'index.html'),
      '<html><head><meta name="aye-aye-token" content="__AYE_AYE_TOKEN__"><title>Aye-aye</title></head></html>',
    );
  });

  it('serves the page with a session token and the API on a free port', async () => {
    const server = await startServer({ port: 0, isProd: true, clientDir, dataDir });
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      const html = await (await fetch(server.url)).text();
      const token = /content="([^"]+)"/.exec(html)?.[1] ?? '';
      assert.ok(token.length > 20 && token !== '__AYE_AYE_TOKEN__');
      const res = await fetch(`${server.url}/api/connections`, { headers: { 'x-aye-aye-token': token } });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), [], 'uses the isolated data folder');
    } finally {
      await server.close();
    }
  });

  it('falls back to a free port when the preferred one is taken, and frees it on close', async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as net.AddressInfo).port;
    try {
      await assert.rejects(startServer({ port: taken, isProd: true, clientDir, dataDir }), { code: 'EADDRINUSE' });
      const server = await startServer({ port: taken, fallbackToFreePort: true, isProd: true, clientDir, dataDir });
      assert.notEqual(server.port, taken);
      await server.close();
      await server.close(); // idempotent
      await assert.rejects(fetch(server.url), 'port released after close');
    } finally {
      blocker.close();
    }
  });

  it('fails clearly when the client build is missing', async () => {
    const empty = await tmp('aye-aye-empty-');
    await assert.rejects(startServer({ port: 0, isProd: true, clientDir: empty, dataDir }), /npm run build/);
  });
});
