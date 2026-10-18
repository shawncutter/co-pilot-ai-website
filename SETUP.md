# One-time setup — then zero involvement

Everything below happens **once**. After it, the system runs itself every week:
signups, billing, cancellations, intake, starter packages, weekly briefings,
the portal, and free samples. **The only things that reach you are 1:1 requests and 1:1 payments.**

**Rate card:** Co-Pilot membership **$50/month, cancel anytime, no refunds**, starter package included.
**1:1 sessions $500/hour**, billed privately; the website shows "Request pricing".

Budget about 90 minutes. Do it in **Stripe test mode first**, run a test signup, then repeat
the Stripe step with live keys.

---

## 0. Accounts you need (all owned by Phase 2 Labs LLC)

| Account | Why | Notes |
| --- | --- | --- |
| **Stripe** | Subscriptions, consulting payments, receipts, tax | Register under Phase 2 Labs LLC (EIN + LLC bank account) |
| **Cloudflare** | Hosting, database, weekly scheduler, queue, inbound email | Free plan works to start; Workers Paid ($5/mo) recommended for queues and longer cron runs |
| **Resend** | Sends the weekly drops and sign-in links | Verify the sending domain (co-pilot.ai) |
| **Anthropic** (Claude) | Writes each subscriber's drop | console.anthropic.com |
| **OpenAI** (ChatGPT / Codex) | QA pass on every drop | platform.openai.com |
| **Google AI Studio** (Gemini) | Digests the week's raw notes | aistudio.google.com |
| **xAI** (Grok) | Frontier scan of X + the Grok bot teaser | console.x.ai |
| **OpenRouter** (open-source models) | Cheap private redaction + fallback | openrouter.ai — or point `OSS_BASE_URL` at your own MLX Serve / llama.cpp |
| **Calendar booking link** | Where paid consulting clients pick a slot | Cal.com or Calendly |
| **Muse.ai** | Hosts your "how I work" walkthrough videos | Optional at launch |

You don't need every model provider on day one. The router skips any provider without a key,
so **Claude alone is enough to launch**; add the others to get the full multi-model engine.

---

## 1. Install and log in

```bash
cd phase2-coach
npm install
npx wrangler login
```

## 2. Database and queue

```bash
npx wrangler d1 create coach-db          # copy the database_id into wrangler.toml
npm run db:init                          # creates the tables
npx wrangler queues create coach-drops
```

## 3. Stripe (Phase 2 Labs LLC) — one command

```bash
STRIPE_SECRET_KEY=sk_test_... npm run setup:stripe -- https://coach.co-pilot.ai
```

This sets up the whole rate card and prints the exact `wrangler secret put` lines to paste:

- **Co-Pilot membership**, $50/month. Checkout states "cancel anytime, payments are non-refundable" on
  the payment page, and the site requires a tick-box acknowledgement before checkout.
  (`COMMITMENT_MONTHS` in wrangler.toml can bring back a minimum term later; 0 means none.)
- **1:1 session**, $500/hour, plus a **private payment link** (1–10 hours, adjustable) to send after
  you quote. It is never shown on the website.
- A **Customer Portal configuration** with cancel turned off: members update cards and download
  receipts there, and cancel from the app, which ends the membership at the end of month 4 if they
  cancel early, or at the end of the billing period after that.
- The webhook. It also retires the old $100 Pro plan and the $1,250 hourly price if they exist.

Bill 1:1 time after a session (sends a Stripe invoice, due in 7 days; quarter hours allowed):

```bash
STRIPE_SECRET_KEY=sk_live_... npm run bill:hours -- client@example.com 1.5 "Agent setup session"
```

Then, in the Stripe dashboard:
- **Settings → Billing → Subscriptions and emails →** turn on failed-payment emails and Smart Retries
  (Stripe chases failed cards for you).
- **Product catalog → Coupons → Promotion codes:** one code per referral partner (e.g. `ED20`,
  `JORNELL20`). Checkout accepts codes automatically, so attribution needs no tracking from you.

## 4. Secrets

```bash
npx wrangler secret put STRIPE_SECRET_KEY
# (+ the four STRIPE_* lines the setup script printed)
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SESSION_SECRET         # any long random string: openssl rand -hex 32
npx wrangler secret put CAPTURE_TOKEN          # another: openssl rand -hex 32
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put XAI_API_KEY
npx wrangler secret put OSS_API_KEY            # OpenRouter key
npx wrangler secret put CONSULTING_ALERT_EMAIL # where paid-consulting alerts go (you)
npx wrangler secret put BOOKING_URL            # your Cal.com / Calendly link
```

## 5. Model IDs

In `wrangler.toml` under `[vars]`, set `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`,
`XAI_MODEL` and `OSS_MODEL` to each provider's **current** model id (from their docs/console).
They're plain config, so moving to a newer model later is a one-line change and a redeploy.

Grok's live X search: if you want the frontier scan to search X directly, paste xAI's current
search/tool config as JSON into the `XAI_SEARCH_JSON` secret (see console.x.ai docs). Without it,
Grok still summarizes the practitioner feeds.

## 6. Email sending

In Resend, add and verify the domain `co-pilot.ai` (it gives you DNS records to add). Then set
`EMAIL_FROM` in `wrangler.toml` (default `Co-Pilots AI Coaching <coach@co-pilot.ai>`).

## 7. Deploy and put it on your domain

```bash
npm run deploy
```

Cloudflare dashboard → Workers → `copilots-coach` → **Settings → Domains & Routes → Add custom
domain** → `coach.co-pilot.ai` (requires co-pilot.ai's DNS on Cloudflare; until then the
`*.workers.dev` URL works — set `APP_URL` to whichever you use).

Check it: open `https://coach.co-pilot.ai/api/health` — it lists the model providers it can use.

---

## 8. Capture: getting your week in with zero effort

The engine needs to know how you used AI each week. Pick any of these — they all run on their own.

**A. Weekly Claude scheduled task (recommended).** A Claude scheduled task with your Day and
Gmail connectors reads your week and emails a summary to the capture inbox. Prompt to use:

> Every Sunday at 6pm ET: review my last 7 days in Day (meeting notes, AI Saturday recaps) and my
> Claude/Cowork work. Write a plain list of how I used AI this week: for each item, the job I was
> doing, the tool or model, the workflow, and the actual prompt or setup if available. Exclude
> client names, deal terms, dollar figures and anything confidential. Email it from my account to
> capture@co-pilot.ai with the subject "AI week".

Ask Claude to create it once the domain is live (it can set the scheduled task up for you).

**B. Capture inbox.** Cloudflare dashboard → your domain → **Email → Email Routing** → route
`capture@co-pilot.ai` to the Worker `copilots-coach`. Only senders listed in `CAPTURE_EMAIL_FROM`
are accepted. Then add a Gmail filter that auto-forwards your AI Saturday recap emails there.

**C. Any automation (Zapier, iOS Shortcut, scripts).**

```bash
curl -X POST https://coach.co-pilot.ai/api/capture \
  -H "Authorization: Bearer $CAPTURE_TOKEN" -H "content-type: application/json" \
  -d '{"title":"Deal screening","body":"Ran a Claude orchestrator over 40 inbound decks..."}'
```

Quiet week? The frontier feed (practitioner blogs + Grok's X scan) backfills, so drops always ship.

## 9. Optional extras

- **Walkthrough videos (Muse.ai):** record screen walkthroughs, upload to Muse.ai, and paste their
  embed URLs into `MUSE_VIDEOS` as `[{"title":"…","url":"https://muse.ai/embed/…"}]`.
  Every member sees all of them.
- **Grok bot on X:** set `X_USER_ACCESS_TOKEN` (an X API user token with post permission; needs a
  paid X API tier) and `X_POSTING = "1"`. It posts the weekly teaser automatically.
- **Ops alerts:** set `OPS_ALERT_EMAIL` to a VA or Augustine (not you) if you want failure alerts.
- **Privacy blocklist:** edit `REDACT_TERMS` with every client, deal and partner name that must
  never reach a subscriber.

---

## 10. Go-live checklist

- [ ] Test mode: tick the no-refund box, subscribe with card `4242 4242 4242 4242`, fill the intake, receive the starter package
- [ ] Test mode: press Cancel in the portal; confirm Stripe shows the subscription ending 4 months after signup
- [ ] Test mode: send a 1:1 request from the site; confirm you get it and the requester gets an acknowledgement
- [ ] Test mode: pay the private 1:1 link for 2 hours; confirm your alert and the buyer's booking link
- [ ] Test mode: `npm run bill:hours -- you@yourdomain.com 1 --dry-run`, then without `--dry-run`
- [ ] If your D1 database was created before this change, run `migrations/0002_rate_card.sql` once
- [ ] Have counsel review `/terms`, `/privacy`, `/refunds` (drafts are built in)
- [ ] Re-run step 3 with `sk_live_...`, update the Stripe secrets, redeploy
- [ ] Set up capture option A or B
- [ ] Add the referral promo codes for Ed and Jornell
- [ ] Link "AI Coaching" from co-pilot.ai to `https://coach.co-pilot.ai`

## What runs without you, forever

| Event | What happens automatically |
| --- | --- |
| Someone subscribes | Tick the no-refund box → Stripe checkout → intake → starter package within minutes |
| Every Monday 9am ET | Week built from your capture + frontier → every profile gets its own drop |
| Card fails | Stripe retries and emails them; access pauses until paid |
| Someone cancels | One click in the portal; it ends at the close of the paid month, no refund |
| Prospect wants a taste | Free sample, once per email, capped per day |
| Someone requests 1:1 | **You get one email** with who, what and when; they get an acknowledgement. You reply with a quote |
| Someone pays for 1:1 | **You get one email**; they get your booking link. Or bill after with `npm run bill:hours` |
