import express, { type Express } from 'express';
import { resolveTargetUrl, selectBestMapping, type PurlMapping } from './resolution.ts';

interface ResolverDependencies {
  findMappings(paths: string[]): Promise<PurlMapping[]>;
  cache: {
    get(key: string): Promise<string | null>;
    setEx(key: string, seconds: number, value: string): Promise<unknown>;
    incr(key: string): Promise<number>;
  };
}

function getPathCandidates(requestPath: string): string[] {
  const segments = requestPath.split('/').filter(Boolean);
  const candidates: string[] = [];

  for (let length = segments.length; length > 0; length -= 1) {
    candidates.push(`/${segments.slice(0, length).join('/')}`);
  }

  candidates.push('/');
  return candidates;
}

export function createResolverApp({ findMappings, cache }: ResolverDependencies): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('*', async (req, res) => {
    const requestPath = req.path;

    try {
      const cacheVersion = await cache.get('purl:cache-version') ?? '0';
      const cacheKey = `purl:${cacheVersion}:${requestPath}`;
      const cachedTarget = await cache.get(cacheKey);
      if (cachedTarget) return res.redirect(302, cachedTarget);

      const mapping = selectBestMapping(requestPath, await findMappings(getPathCandidates(requestPath)));
      if (!mapping) return res.status(404).send('PURL not found');

      const target = resolveTargetUrl(mapping.targetUrl, mapping.path, requestPath);
      await cache.setEx(cacheKey, 3600, target);
      return res.redirect(302, target);
    } catch (error) {
      console.error('Resolution failed:', error);
      return res.status(500).send('Internal Server Error');
    }
  });

  return app;
}