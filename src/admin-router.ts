import { Router, type NextFunction, type Request, type Response } from 'express';
import { purlMappings } from './schema.ts';

export type PurlRecord = typeof purlMappings.$inferSelect;

export interface CreatePurlInput {
  path: string;
  targetUrl: string;
  title: string;
  description: string | null;
}

export interface UpdatePurlInput {
  targetUrl?: string;
  title?: string;
  description?: string | null;
  isActive?: boolean;
}

export interface AdminRepository {
  list(): Promise<PurlRecord[]>;
  create(input: CreatePurlInput): Promise<PurlRecord>;
  update(id: number, input: UpdatePurlInput): Promise<PurlRecord | null>;
}

interface AdminRouterDependencies {
  repository: AdminRepository;
  invalidateCache(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500 || !value.startsWith('/')) return null;
  if (value === '/') return value;
  const segments = value.slice(1).split('/');
  if (segments.some((segment) => !/^[A-Za-z0-9._~-]+$/.test(segment) || segment === '.' || segment === '..')) {
    return null;
  }
  return value;
}

function validateTargetUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const target = new URL(value);
    if ((target.protocol !== 'https:' && target.protocol !== 'http:') || target.username || target.password) {
      return null;
    }
    return target.toString();
  } catch {
    return null;
  }
}

function validateTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length > 0 && title.length <= 200 ? title : null;
}

function validateDescription(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  return value.trim() || null;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.adminUsername) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === '23505';
}

export function createAdminRouter({ repository, invalidateCache }: AdminRouterDependencies): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/purls', async (_req, res) => {
    try {
      res.json(await repository.list());
    } catch (error) {
      console.error('Failed to list PURLs:', error);
      res.status(500).json({ error: 'Failed to load PURLs.' });
    }
  });

  router.post('/purls', async (req, res) => {
    if (!isRecord(req.body)) return res.status(400).json({ error: 'Invalid PURL payload.' });

    const path = validatePath(req.body.path);
    const targetUrl = validateTargetUrl(req.body.targetUrl);
    const title = validateTitle(req.body.title);
    const description = req.body.description === undefined ? null : validateDescription(req.body.description);
    if (!path || !targetUrl || !title || description === undefined) {
      return res.status(400).json({ error: 'Provide a valid path, HTTP(S) target, title, and description.' });
    }

    try {
      const created = await repository.create({ path, targetUrl, title, description });
      await invalidateCache();
      return res.status(201).json(created);
    } catch (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: 'That PURL path already exists.' });
      console.error('Failed to create PURL:', error);
      return res.status(500).json({ error: 'Failed to create PURL.' });
    }
  });

  router.put('/purls/:id', async (req, res) => {
    if (!isRecord(req.body) || Object.hasOwn(req.body, 'path')) {
      return res.status(400).json({ error: 'PURL paths are immutable.' });
    }

    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid PURL id.' });

    const update: UpdatePurlInput = {};
    if (Object.hasOwn(req.body, 'targetUrl')) {
      const targetUrl = validateTargetUrl(req.body.targetUrl);
      if (!targetUrl) return res.status(400).json({ error: 'Provide a valid HTTP(S) target URL.' });
      update.targetUrl = targetUrl;
    }
    if (Object.hasOwn(req.body, 'title')) {
      const title = validateTitle(req.body.title);
      if (!title) return res.status(400).json({ error: 'Title must contain between 1 and 200 characters.' });
      update.title = title;
    }
    if (Object.hasOwn(req.body, 'description')) {
      const description = validateDescription(req.body.description);
      if (description === undefined) return res.status(400).json({ error: 'Description must be 2000 characters or fewer.' });
      update.description = description;
    }
    if (Object.hasOwn(req.body, 'isActive')) {
      if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be a boolean.' });
      update.isActive = req.body.isActive;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No update fields provided.' });

    try {
      const updated = await repository.update(id, update);
      if (!updated) return res.status(404).json({ error: 'PURL not found.' });
      await invalidateCache();
      return res.json(updated);
    } catch (error) {
      console.error('Failed to update PURL:', error);
      return res.status(500).json({ error: 'Failed to update PURL.' });
    }
  });

  return router;
}