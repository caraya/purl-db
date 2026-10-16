import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import express from 'express';
import session from 'express-session';
import { describe, test } from 'node:test';
import { createAdminRouter, type AdminRepository, type PurlRecord } from '../src/admin-router.ts';

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

function createTestApp(repository: AdminRepository, authenticated: boolean, invalidate: () => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-session-secret-that-is-long-enough', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (authenticated) req.session.adminUsername = 'maintainer';
    next();
  });
  app.use('/api/admin', createAdminRouter({ repository, invalidateCache: invalidate }));
  return app;
}

function createRecord(overrides: Partial<PurlRecord> = {}): PurlRecord {
  return {
    id: 1,
    path: '/research/data',
    targetUrl: 'https://example.org/archive/',
    title: 'Research data',
    description: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('admin PURL API', () => {
  test('requires an authenticated session', async () => {
    const repository: AdminRepository = {
      list: async () => [],
      create: async () => createRecord(),
      update: async () => null,
    };
    const server = createServer(createTestApp(repository, false, async () => undefined));
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/api/admin/purls`);
      assert.equal(response.status, 401);
    } finally {
      await close(server);
    }
  });

  test('validates creation and rejects path edits while invalidating resolution cache on updates', async () => {
    let updateCount = 0;
    let invalidationCount = 0;
    const repository: AdminRepository = {
      list: async () => [createRecord()],
      create: async (input) => createRecord(input),
      update: async (_id, input) => {
        updateCount += 1;
        return createRecord(input);
      },
    };
    const server = createServer(createTestApp(repository, true, async () => { invalidationCount += 1; }));
    const baseUrl = await listen(server);

    try {
      const invalidTarget = await fetch(`${baseUrl}/api/admin/purls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/valid/path', targetUrl: 'javascript:alert(1)', title: 'Unsafe' }),
      });
      assert.equal(invalidTarget.status, 400);

      const created = await fetch(`${baseUrl}/api/admin/purls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/valid/path', targetUrl: 'https://example.org/base/', title: 'Valid' }),
      });
      assert.equal(created.status, 201);

      const pathEdit = await fetch(`${baseUrl}/api/admin/purls/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/changed/path', targetUrl: 'https://example.org/new/', title: 'Changed' }),
      });
      assert.equal(pathEdit.status, 400);
      assert.equal(updateCount, 0);

      const updated = await fetch(`${baseUrl}/api/admin/purls/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: 'https://example.org/new/', title: 'Changed', isActive: false }),
      });
      assert.equal(updated.status, 200);
      assert.equal(updateCount, 1);
      assert.equal(invalidationCount, 2);
    } finally {
      await close(server);
    }
  });
});