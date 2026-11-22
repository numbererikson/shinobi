import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import {
  checkPluginUpdates,
  checkPluginUrl,
  fetchCatalog,
  fileNameFromUrl,
  installFromUrl,
  listPluginFiles,
  removePluginFile,
  restartNeeded,
  updatePluginFile,
} from './files.js';

let dir: string;
let srv: http.Server;
let base: string;
const served: Record<string, string> = {
  '/shinobi-plugin-demo.mjs': "export default function register(registry) { registry.registerTool({ name: 'plugin_demo_hi' }); }\n",
  '/not-a-plugin.mjs': 'console.log("hello")\n',
  '/huge.mjs': 'export default 1;\n' + 'x'.repeat(2 * 1024 * 1024 + 10),
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'shinobi-plugin-files-'));
  process.env.SHINOBI_PLUGINS_DIR = dir;
  srv = http.createServer((req, res) => {
    if (req.url === '/catalog.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          plugins: [
            { id: 'demo', name: 'Demo', description: 'A demo', url: `${base}/shinobi-plugin-demo.mjs` },
            { id: 'bad', name: 'Bad', url: 'ftp://example.com/x.mjs' },
            'junk',
          ],
        }),
      );
      return;
    }
    const body = served[req.url ?? ''];
    if (body === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(body);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => srv.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SHINOBI_PLUGINS_DIR;
});

describe('URL rules', () => {
  it('needs https (http only on loopback) and a single .mjs/.js file', () => {
    expect(() => checkPluginUrl('http://example.com/a.mjs')).toThrow(/https/);
    expect(checkPluginUrl('https://example.com/a.mjs').hostname).toBe('example.com');
    expect(checkPluginUrl('http://127.0.0.1:9/a.mjs').hostname).toBe('127.0.0.1');
    expect(() => fileNameFromUrl(new URL('https://example.com/'))).toThrow(/single .mjs or .js file/);
    expect(() => fileNameFromUrl(new URL('https://example.com/../../etc/passwd'))).toThrow();
    expect(fileNameFromUrl(new URL('https://example.com/x/shinobi-plugin-music.mjs?raw=1'))).toBe('shinobi-plugin-music.mjs');
  });
});

describe('install / update / remove', () => {
  it('installs from a URL, records the source, detects updates and removes', async () => {
    const f = await installFromUrl(`${base}/shinobi-plugin-demo.mjs`);
    expect(f.file).toBe('shinobi-plugin-demo.mjs');
    expect(f.pending_restart).toBe(true);
    expect(readFileSync(join(dir, 'shinobi-plugin-demo.mjs'), 'utf8')).toContain('plugin_demo_hi');
    expect(restartNeeded()).toBe(true);

    expect((await checkPluginUpdates())[0]).toMatchObject({ file: 'shinobi-plugin-demo.mjs', update_available: false });
    served['/shinobi-plugin-demo.mjs'] += '// v2\n';
    expect((await checkPluginUpdates())[0]?.update_available).toBe(true);
    await updatePluginFile('shinobi-plugin-demo.mjs');
    expect(readFileSync(join(dir, 'shinobi-plugin-demo.mjs'), 'utf8')).toContain('// v2');
    expect((await checkPluginUpdates())[0]?.update_available).toBe(false);

    expect(listPluginFiles().map((p) => p.file)).toEqual(['shinobi-plugin-demo.mjs']);
    expect(removePluginFile('shinobi-plugin-demo.mjs')).toBe(true);
    expect(existsSync(join(dir, 'shinobi-plugin-demo.mjs'))).toBe(false);
    expect(listPluginFiles()).toEqual([]);
    expect(() => removePluginFile('../escape.mjs')).toThrow(/invalid plugin file name/);
  });

  it('refuses non-modules, oversized files and missing files', async () => {
    await expect(installFromUrl(`${base}/not-a-plugin.mjs`)).rejects.toThrow(/does not look like a plugin/);
    await expect(installFromUrl(`${base}/huge.mjs`)).rejects.toThrow(/larger than 2 MB/);
    await expect(installFromUrl(`${base}/missing.mjs`)).rejects.toThrow(/HTTP 404/);
    await expect(updatePluginFile('never-installed.mjs')).rejects.toThrow(/not installed from a URL/);
  });

  it('reads the catalog, skipping bad entries and marking installed ones', async () => {
    const before = await fetchCatalog(`${base}/catalog.json`);
    expect(before).toEqual([{ id: 'demo', name: 'Demo', description: 'A demo', url: `${base}/shinobi-plugin-demo.mjs`, installed: false }]);
    await installFromUrl(`${base}/shinobi-plugin-demo.mjs`);
    expect((await fetchCatalog(`${base}/catalog.json`))[0]?.installed).toBe(true);
  });
});
