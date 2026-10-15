import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().default(0),
  body: text('body').notNull(),
});
