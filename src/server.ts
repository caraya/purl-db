import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import express from 'express';
import session from 'express-session';
import { Client } from 'pg';
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import { join } from 'node:path';
import { createAdminRouter, type AdminRepository } from './admin-router.ts';
import { createOAuthRouter } from './auth-router.ts';
import { purlMappings } from './schema.ts';
import { createResolverApp } from './resolver-app.ts';

interface Environment {
  databaseUrl: string;
  redisUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  githubUsername: string;
  sessionSecret: string;
  appOrigin: string;
  port: number;
  trustProxy: boolean;
}

function validateEnv(): Environment {
  const required = [
    'DATABASE_URL',
    'REDIS_URL',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_USERNAME',
    'SESSION_SECRET',
  ];
  for (const envVar of required) {
    if (!process.env[envVar]) {
      throw new Error(`FATAL: Missing critical environment variable: ${envVar}`);
    }
  }

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('FATAL: PORT must be an integer between 1 and 65535.');
  }

  const sessionSecret = process.env.SESSION_SECRET!;
  if (Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('FATAL: SESSION_SECRET must contain at least 32 bytes.');
  }

  const appOrigin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
  const parsedOrigin = new URL(appOrigin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) {
    throw new Error('FATAL: APP_ORIGIN must be an HTTP(S) origin without a path, query, or fragment.');
  }

  return {
    databaseUrl: process.env.DATABASE_URL!,
    redisUrl: process.env.REDIS_URL!,
    githubClientId: process.env.GITHUB_CLIENT_ID!,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET!,
    githubUsername: process.env.GITHUB_USERNAME!,
    sessionSecret,
    appOrigin: parsedOrigin.origin,
    port,
    trustProxy: process.env.TRUST_PROXY === 'true',
  };
}

const { databaseUrl, redisUrl, githubClientId, githubClientSecret, githubUsername, sessionSecret, appOrigin, port, trustProxy } = validateEnv();
const pgClient = new Client({ connectionString: databaseUrl });
const db = drizzle(pgClient, { schema: { purlMappings } });
const redisClient = createClient({ url: redisUrl });
redisClient.on('error', (error) => console.error('Redis error:', error));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', trustProxy ? 1 : false);
app.use(session({
  name: 'purl.sid',
  store: new RedisStore({ client: redisClient }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: 'auto',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));
app.use(express.json({ limit: '16kb' }));
app.use('/api/admin/auth', createOAuthRouter({
  clientId: githubClientId,
  clientSecret: githubClientSecret,
  allowedUsername: githubUsername,
  callbackUrl: `${appOrigin}/api/admin/auth/github/callback`,
}));

const adminRepository: AdminRepository = {
  list: () => db.query.purlMappings.findMany({
    orderBy: (purls, { desc }) => [desc(purls.createdAt)],
  }),
  create: async (input) => {
    const [created] = await db.insert(purlMappings).values(input).returning();
    return created;
  },
  update: async (id, input) => {
    const [updated] = await db.update(purlMappings)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(purlMappings.id, id))
      .returning();
    return updated ?? null;
  },
};

app.use('/api/admin', createAdminRouter({
  repository: adminRepository,
  invalidateCache: async () => { await redisClient.incr('purl:cache-version'); },
}));

const publicDirectory = join(process.cwd(), 'dist', 'public');
app.get('/admin', (_req, res) => res.sendFile(join(publicDirectory, 'index.html')));
app.use(express.static(publicDirectory, { index: false }));

app.use(createResolverApp({
  findMappings: async (paths) => db.query.purlMappings.findMany({
    where: and(inArray(purlMappings.path, paths), eq(purlMappings.isActive, true)),
  }),
  cache: redisClient,
}));

async function startup(): Promise<void> {
  await pgClient.connect();
  await redisClient.connect();
  app.listen(port, () => console.log(`Resolver running on port ${port}`));
}

startup().catch(async (error: unknown) => {
  console.error('Resolver startup failed:', error);
  if (redisClient.isOpen) await redisClient.quit();
  await pgClient.end().catch(() => undefined);
  process.exitCode = 1;
});