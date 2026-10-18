-- Phase 2 Labs LLC — Co-Pilots AI Coaching
-- Cloudflare D1 (SQLite) schema. Apply with:
--   npx wrangler d1 execute coach-db --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS subscribers (
  id                 TEXT PRIMARY KEY,           -- uuid
  email              TEXT NOT NULL UNIQUE,
  name               TEXT,
  plan               TEXT NOT NULL DEFAULT 'core', -- core (single membership)
  status             TEXT NOT NULL DEFAULT 'pending', -- pending | active | past_due | canceled
  stripe_customer_id TEXT,
  stripe_sub_id      TEXT,
  referral_code      TEXT,                       -- Stripe promo code used (partner attribution)
  commitment_ends_at TEXT,                       -- ISO date the minimum term ends (checkout + COMMITMENT_MONTHS)
  cancels_at         TEXT,                       -- ISO date a scheduled cancellation takes effect
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sub_status ON subscribers(status);
CREATE INDEX IF NOT EXISTS idx_sub_customer ON subscribers(stripe_customer_id);

-- A subscriber's use-case profile(s). Core = 1, Pro = up to 2.
CREATE TABLE IF NOT EXISTS profiles (
  id             TEXT PRIMARY KEY,
  subscriber_id  TEXT NOT NULL REFERENCES subscribers(id),
  label          TEXT NOT NULL DEFAULT 'Primary',
  role           TEXT,            -- e.g. "Managing partner"
  industry       TEXT,            -- e.g. "Law firm, 12 attorneys"
  tools          TEXT,            -- what they use today
  goals          TEXT,            -- what they want AI to do for them
  ai_level       TEXT,            -- new | some | daily
  vertical       TEXT,            -- legal | investing | real_estate | general ...
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profile_sub ON profiles(subscriber_id);

-- Raw items describing how Shawn used AI (pushed via /api/capture, inbound email,
-- or pulled from the frontier feed by the weekly job).
CREATE TABLE IF NOT EXISTS capture_items (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,      -- api | email | rss | grok
  title       TEXT,
  body        TEXT NOT NULL,
  url         TEXT,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  week_id     TEXT                -- set once consumed into a week digest
);
CREATE INDEX IF NOT EXISTS idx_capture_week ON capture_items(week_id, captured_at);

-- One row per weekly run: the redacted digest every drop is adapted from.
CREATE TABLE IF NOT EXISTS weeks (
  id          TEXT PRIMARY KEY,   -- e.g. 2026-W42
  digest      TEXT NOT NULL,      -- redacted markdown digest of the week
  frontier    TEXT,               -- frontier-feed summary (AI masters)
  teaser      TEXT,               -- public teaser (Grok bot)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One personalized drop per subscriber profile per week.
CREATE TABLE IF NOT EXISTS drops (
  id             TEXT PRIMARY KEY,
  subscriber_id  TEXT NOT NULL REFERENCES subscribers(id),
  profile_id     TEXT,
  week_id        TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'weekly', -- weekly | welcome | sample
  subject        TEXT NOT NULL,
  body_md        TEXT NOT NULL,
  qa_notes       TEXT,
  emailed_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (profile_id, week_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_drops_sub ON drops(subscriber_id, created_at);

-- Free "wow" samples for prospects (one per email — the wow then stops).
CREATE TABLE IF NOT EXISTS samples (
  email       TEXT PRIMARY KEY,
  profile     TEXT NOT NULL,
  body_md     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1:1 pricing requests from the website or portal (Shawn replies with a quote).
CREATE TABLE IF NOT EXISTS consulting_requests (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT,
  company     TEXT,
  topic       TEXT NOT NULL,
  timing      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Paid 1:1 time (private payment link, or an invoice sent with scripts/bill-hours.mjs).
CREATE TABLE IF NOT EXISTS consulting_orders (
  id                 TEXT PRIMARY KEY,   -- Stripe checkout session id
  email              TEXT NOT NULL,
  hours              INTEGER NOT NULL,
  amount_cents       INTEGER NOT NULL,
  topic              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Webhook idempotency: each Stripe event is processed once.
CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,
  type        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
