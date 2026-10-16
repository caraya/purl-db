import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import express from 'express';
import session from 'express-session';
import { describe, test } from 'node:test';
import { createOAuthRouter } from '../src/auth-router.ts';

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

describe('GitHub OAuth routes', () => {
  test('rejects OAuth state mismatches and signs in only the configured GitHub user', async () => {
    let githubRequests = 0;
    const app = express();
    app.use(session({ secret: 'test-session-secret-that-is-long-enough', resave: false, saveUninitialized: false }));
    app.use('/api/admin/auth', createOAuthRouter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      allowedUsername: 'trusted-maintainer',
      callbackUrl: 'http://localhost/api/admin/auth/github/callback',
      fetcher: async (input) => {
        githubRequests += 1;
        if (String(input).includes('/login/oauth/access_token')) {
          return Response.json({ access_token: 'github-token' });
        }
        return Response.json({ login: 'trusted-maintainer' });
      },
    }));
    app.get('/session', (req, res) => res.json({ adminUsername: req.session.adminUsername ?? null }));
    const server = createServer(app);
    const baseUrl = await listen(server);

    try {
      const login = await fetch(`${baseUrl}/api/admin/auth/github`, { redirect: 'manual' });
      assert.equal(login.status, 302);
      const authorizationUrl = new URL(login.headers.get('location') ?? '');
      assert.equal(authorizationUrl.origin, 'https://github.com');
      const state = authorizationUrl.searchParams.get('state');
      assert.ok(state);
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
      assert.ok(cookie);

      const mismatch = await fetch(`${baseUrl}/api/admin/auth/github/callback?code=code&state=wrong`, {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      assert.equal(mismatch.status, 400);
      assert.equal(githubRequests, 0);

      const retryLogin = await fetch(`${baseUrl}/api/admin/auth/github`, {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      const retryState = new URL(retryLogin.headers.get('location') ?? '').searchParams.get('state');
      const retryCookie = retryLogin.headers.get('set-cookie')?.split(';', 1)[0] ?? cookie;
      assert.ok(retryState);

      const callback = await fetch(
        `${baseUrl}/api/admin/auth/github/callback?code=code&state=${encodeURIComponent(retryState)}`,
        { headers: { Cookie: retryCookie }, redirect: 'manual' },
      );
      assert.equal(callback.status, 302);
      assert.equal(callback.headers.get('location'), '/admin');
      assert.equal(githubRequests, 2);

      const authenticatedCookie = callback.headers.get('set-cookie')?.split(';', 1)[0];
      assert.ok(authenticatedCookie);
      const sessionResponse = await fetch(`${baseUrl}/session`, { headers: { Cookie: authenticatedCookie } });
      assert.deepEqual(await sessionResponse.json(), { adminUsername: 'trusted-maintainer' });
    } finally {
      await close(server);
    }
  });
});