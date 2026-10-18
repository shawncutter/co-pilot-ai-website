# Co-Pilots AI Coaching

An adaptive weekly AI-coaching subscription, operated by **Phase 2 Labs LLC**.
Every week it captures how Shawn Cutter actually used AI, scrubs anything confidential,
and rebuilds it into a unique drop for each subscriber's role, industry and goals.

**Start here:** [SETUP.md](SETUP.md) — one-time setup, then it runs itself.

## How it works

```
capture (Claude task / email / API)  +  frontier feed (practitioner RSS + Grok on X)
        │
        ▼
redact (blocklist + open-source model)  →  weekly digest (Gemini)
        │
        ▼  fan-out queue, one job per subscriber profile
adapt (Claude)  →  QA (GPT, one auto-revision)  →  email (Resend) + portal
```

- **Billing:** Stripe Checkout + Customer Portal, webhooks keep status in sync.
- **Access:** passwordless magic links; no accounts to manage.
- **Rate card:** $50/month membership, cancel anytime, no refunds, starter package included; 1:1 sessions
  $500/hour, quoted on request ("Request pricing" on the site), paid by private link or invoice.
- **Models:** `src/models.js` routes each task to its best provider and falls back automatically
  across Claude, ChatGPT/Codex, Gemini, Grok and open-source models.

## Project layout

| Path | What it is |
| --- | --- |
| `src/index.js` | Worker entry: routes, Stripe webhook, cron, queue consumer, inbound email |
| `src/engine.js` | The weekly engine: build week, write drops, deliver, samples |
| `src/models.js` | Multi-model router |
| `src/prompts.js` | Every prompt the engine uses |
| `src/redact.js` | Privacy filter |
| `src/pages.js` | Landing, sample, intake, portal, legal pages |
| `schema.sql` | D1 database schema |
| `scripts/setup-stripe.mjs` | Creates Stripe products, prices and webhook in one command |
| `test/` | Unit + end-to-end tests (`npm test`) |

## Commands

```bash
npm test            # 14 tests, no keys needed (models, Stripe and email are mocked)
npm run dev         # local dev server
npm run deploy      # deploy to Cloudflare
```
