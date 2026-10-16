import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request as ExpressRequest, type Response as ExpressResponse } from 'express';

interface OAuthRouterOptions {
  clientId: string;
  clientSecret: string;
  allowedUsername: string;
  callbackUrl: string;
  fetcher?: typeof globalThis.fetch;
}

function saveSession(req: ExpressRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(req: ExpressRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function stateMatches(expected: string | undefined, actual: unknown): boolean {
  if (!expected || typeof actual !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireAuth(req: ExpressRequest, res: ExpressResponse, next: (error?: unknown) => void): void {
  if (!req.session.adminUsername) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

export function createOAuthRouter({
  clientId,
  clientSecret,
  allowedUsername,
  callbackUrl,
  fetcher = globalThis.fetch,
}: OAuthRouterOptions): Router {
  const router = Router();

  router.get('/github', (req, res) => {
    const state = randomBytes(32).toString('hex');
    req.session.oauthState = state;
    req.session.save((error) => {
      if (error) {
        console.error('Failed to save OAuth state:', error);
        res.status(500).send('Unable to start GitHub sign-in.');
        return;
      }

      const authorizationUrl = new URL('https://github.com/login/oauth/authorize');
      authorizationUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'read:user',
        state,
      }).toString();
      res.redirect(302, authorizationUrl.toString());
    });
  });

  router.get('/github/callback', async (req, res) => {
    const expectedState = req.session.oauthState;
    delete req.session.oauthState;
    if (!stateMatches(expectedState, req.query.state) || typeof req.query.code !== 'string') {
      return res.status(400).send('Invalid GitHub OAuth response.');
    }

    try {
      const tokenResponse = await fetcher('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: req.query.code,
          redirect_uri: callbackUrl,
        }),
      });
      if (!tokenResponse.ok) return res.status(502).send('GitHub sign-in could not be completed.');

      const tokenPayload: unknown = await tokenResponse.json();
      if (!isRecord(tokenPayload) || typeof tokenPayload.access_token !== 'string') {
        return res.status(502).send('GitHub sign-in could not be completed.');
      }

      const profileResponse = await fetcher('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${tokenPayload.access_token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'purl-resolver',
        },
      });
      if (!profileResponse.ok) return res.status(502).send('GitHub sign-in could not be completed.');

      const profile: unknown = await profileResponse.json();
      if (!isRecord(profile) || typeof profile.login !== 'string') {
        return res.status(502).send('GitHub sign-in could not be completed.');
      }
      if (profile.login.toLowerCase() !== allowedUsername.toLowerCase()) {
        return res.status(403).send('This GitHub account is not authorized.');
      }

      await regenerateSession(req);
      req.session.adminUsername = profile.login;
      await saveSession(req);
      return res.redirect(302, '/admin');
    } catch (error) {
      console.error('GitHub OAuth failed:', error);
      return res.status(502).send('GitHub sign-in could not be completed.');
    }
  });

  router.post('/logout', requireAuth, (req, res) => {
    req.session.destroy((error) => {
      if (error) {
        console.error('Failed to destroy admin session:', error);
        res.status(500).json({ error: 'Unable to sign out.' });
        return;
      }
      res.clearCookie('purl.sid', { path: '/', httpOnly: true, sameSite: 'lax' });
      res.status(204).end();
    });
  });

  return router;
}