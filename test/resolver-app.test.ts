import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { describe, test } from 'node:test';
import { createResolverApp } from '../src/resolver-app.ts';

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('resolver HTTP route', () => {
  test('redirects nested requests and caches the resolved target', async () => {
    const cacheEntries = new Map<string, string>();
    let lookupCount = 0;
    const app = createResolverApp({
      findMappings: async (paths) => {
        lookupCount += 1;
        assert.deepEqual(paths, ['/research/data/report.pdf', '/research/data', '/research', '/']);
        return [
          { path: '/research', targetUrl: 'https://example.org/archive', isActive: true },
          { path: '/research/data', targetUrl: 'https://example.org/datasets', isActive: true },
        ];
      },
      cache: {
        get: async (key) => cacheEntries.get(key) ?? null,
        setEx: async (key, _seconds, value) => void cacheEntries.set(key, value),
        incr: async () => 1,
      },
    });
    const server = createServer(app);
    const baseUrl = await listen(server);

    try {
      const firstResponse = await fetch(`${baseUrl}/research/data/report.pdf`, { redirect: 'manual' });
      assert.equal(firstResponse.status, 302);
      assert.equal(firstResponse.headers.get('location'), 'https://example.org/datasets/report.pdf');

      const secondResponse = await fetch(`${baseUrl}/research/data/report.pdf`, { redirect: 'manual' });
      assert.equal(secondResponse.status, 302);
      assert.equal(lookupCount, 1);
    } finally {
      await close(server);
    }
  });

  test('returns 404 when no active mapping matches', async () => {
    const app = createResolverApp({
      findMappings: async () => [],
      cache: { get: async () => null, setEx: async () => 'OK', incr: async () => 1 },
    });
    const server = createServer(app);
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/missing`, { redirect: 'manual' });
      assert.equal(response.status, 404);
      assert.equal(await response.text(), 'PURL not found');
    } finally {
      await close(server);
    }
  });
});