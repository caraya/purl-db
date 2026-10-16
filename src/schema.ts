import { boolean, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const purlMappings = pgTable('purl_mappings', {
  id: serial('id').primaryKey(),
  path: text('path').unique().notNull(),
  targetUrl: text('target_url').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});