-- Rate card (Oct 2026): single $50/month membership with a 4-month minimum, 1:1 by request.
-- Only needed for a database created from an older schema.sql. Apply once:
--   npx wrangler d1 execute coach-db --remote --file=migrations/0002_rate_card.sql
ALTER TABLE subscribers ADD COLUMN commitment_ends_at TEXT;
ALTER TABLE subscribers ADD COLUMN cancels_at TEXT;
CREATE TABLE IF NOT EXISTS consulting_requests (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT,
  company     TEXT,
  topic       TEXT NOT NULL,
  timing      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
UPDATE subscribers SET plan = 'core' WHERE plan = 'pro';
