# Co-Pilots.ai — Launch Setup

Three things turn the current site from a great-looking page into a working funnel:

1. **Reserve buttons** → real Stripe checkout ($50 / $100 deposits)
2. **Destination vote** → real cross-visitor aggregation
3. **Google Form** → capture format + destination preference from applicants

Plus two numbers to keep honest: the **reserve tracker** and the **vote seed counts**.

---

## 1. Stripe — the $50 / $100 reserve deposits

The two Reserve buttons currently point to placeholder URLs
(`REPLACE_WITH_50_LINK`, `REPLACE_WITH_100_LINK` in `index.html`). Replace them
with real Stripe Payment Links — no code, hosted checkout, ~5 minutes.

**Steps**

1. Create/log in to a **Stripe** account → **stripe.com**.
2. Left nav → **Product catalog** → **+ Add product**.
   - Product 1: name **"Lock Your Spot — Reservation Deposit"**, price **$50**, **One-time**.
   - Product 2: name **"Priority Line — Reservation Deposit"**, price **$100**, **One-time**.
3. For each product → **⋯** → **Create payment link**.
   - Under **After payment**, set a confirmation message or redirect back to
     `https://co-pilot.ai/#reserve` (or a "thank you" page).
   - Optionally collect **name + email** (Payment Link → "Options" → collect customer info).
   - Copy the resulting URL — it looks like `https://buy.stripe.com/xxxxxxxx`.
4. In `index.html`, find the two Reserve buttons and paste the URLs:

   ```html
   <!-- $50 tier -->
   <a href="https://buy.stripe.com/YOUR_50_LINK" class="btn-primary rt-cta">Reserve for $50 &rarr;</a>

   <!-- $100 tier -->
   <a href="https://buy.stripe.com/YOUR_100_LINK" class="btn-primary rt-cta">Reserve for $100 &rarr;</a>
   ```

**Refunds (important):** because these are *deposits* you may refund, Stripe
refunds are one click in the dashboard (Payments → select → Refund). Keep the
site's language ("fully refundable until the cohort is confirmed, credited toward
entry") consistent with what you actually do. **Have someone confirm the exact
deposit terms before taking money** — it's a real financial commitment to reservers.

### Auto-updating the "X of 50 locked in" tracker (Stripe webhook)

The reserve bar can move automatically on every paid deposit. The code is included
— you just add a webhook in Stripe and set one secret.

**Files (keep the pair for your host):**
- Cloudflare: `functions/api/stripe-webhook.js` + `functions/api/reserved.js`
- Netlify: `netlify/functions/stripe-webhook.mjs` + `netlify/functions/reserved.mjs`

**Steps**

1. **Add the webhook in Stripe:** Developers → **Webhooks** → **Add endpoint**.
   - Endpoint URL: `https://co-pilot.ai/api/stripe-webhook`
   - Events to send: **`checkout.session.completed`** (add **`payment_intent.succeeded`**
     too if your Payment Links charge without a Checkout Session).
   - Save, then copy the **Signing secret** (`whsec_...`).
2. **Set env vars** on your host:
   - Cloudflare Pages → Settings → **Environment variables & secrets**:
     `STRIPE_WEBHOOK_SECRET = whsec_...`  (and bind the same **`VOTES`** KV namespace
     you used for the vote — the counter lives at key `reserve:count`).
   - Netlify → Site config → **Environment variables**:
     `STRIPE_WEBHOOK_SECRET = whsec_...` **and** `STRIPE_SECRET_KEY = sk_live_...`.
     The Netlify function also needs the `stripe` package — add a `package.json`
     with `{"dependencies":{"stripe":"^16"},"type":"module"}` (or run `npm i stripe`).
3. **Turn on the live count** in `index.html`:

   ```js
   const RESERVE_API = '/api/reserved'; // was ''
   ```

   The bar now shows real paid deposits, and falls back to the `LOCKED` number if the
   API is unreachable. `GOAL` (the 50 threshold) stays editable right below it.
4. **Test:** Stripe → Webhooks → your endpoint → **Send test event**
   (`checkout.session.completed`). Then load the page — the tracker should tick up.
   Visiting `https://co-pilot.ai/api/reserved` should return `{"reserved":N}`.

Notes: the webhook verifies Stripe's signature (rejects forgeries and >5-min-old
replays) and is **idempotent** (each Stripe event id is counted once). Starting count
is 0; if you want to seed it, set `reserve:count` in KV (Cloudflare) or `count` in the
`reserve` blob store (Netlify).

---

## 2. Destination vote — real aggregation

The vote widget already works as a **local straw poll** (each visitor sees the
seed numbers + their own click). To make votes **count across everyone**, deploy a
tiny backend and point the site at it.

The front-end is already wired. In `index.html`, find:

```js
const VOTE_API = ''; // <-- set to '/api/vote' once your function is deployed
```

Set it to `'/api/vote'` after you deploy **one** of the options below. Until then,
it safely falls back to the local straw poll.

### Option A — Cloudflare Pages (file: `functions/api/vote.js`, already included)

1. In the **Cloudflare dashboard** → **Workers & Pages** → your Pages project.
2. **Settings → Functions → KV namespace bindings** → **Add binding**:
   - Variable name: **`VOTES`**
   - KV namespace: create one called e.g. `copilots-votes`.
3. Deploy (push to your connected git branch, or `wrangler pages deploy`).
   The included `functions/api/vote.js` auto-serves at `/api/vote`.
4. Set `VOTE_API = '/api/vote'` in `index.html`, redeploy. Done.

Test: visit `https://co-pilot.ai/api/vote` → you should see `{"counts":{...}}`.

### Option B — Netlify (file: `netlify/functions/vote.mjs`, already included)

1. Enable **Netlify Blobs** (on by default for most sites; it needs no config).
2. The included `netlify/functions/vote.mjs` is configured to serve at `/api/vote`.
3. Deploy (push to your connected branch). Set `VOTE_API = '/api/vote'`, redeploy.

Test: visit `https://co-pilot.ai/api/vote` → `{"counts":{...}}`.

> Keep only the file for your host. If you're on Cloudflare, you can delete
> `netlify/`; if you're on Netlify, you can delete `functions/`.

### Option C — No backend (simplest): Google Form / Typeform poll

If you'd rather not run a function, make the whole "Where" section link to a poll.
Fastest: reuse the destination question in your Google Form (Section 3 below) and
change the vote note's CTA to link there. You lose the live on-page bars but get
real, one-place results. Tell me and I'll swap the section to link-out mode.

### Cold-start / seeding the numbers

Both backends start every city at **0** by default (honest). If you want to seed
opening numbers, edit the `SEED = {...}` object at the top of the function file.
⚠️ The current on-page seed numbers (SF 34, NYC 27, …) are **placeholders** — set
them to something true before you publicize the page.

---

## 3. Google Form — capture format + destination preference

Add these two questions to your existing application form
(the one linked from the Apply button).

**Q — Format preference** (multiple choice, required)

> **Which build format fits you best?**
> We're testing two lengths — your pick helps us balance each cohort.
> - 48-hour Sprint — one intense weekend, ruthless scope, proof-of-concept
> - 96-hour Deep Build — more flow cycles + recovery, closer to a real MVP
> - Either works — put me where I'm needed

**Q — Destination preference** (multiple choice, required)

> **If we run a destination edition, where should it be?**
> - Tampa / Fort Myers (home base)
> - San Francisco
> - New York City
> - Las Vegas
> - Los Angeles
> - No preference / wherever the cohort lands

(To edit: open the form → **+** to add each question → set type to *Multiple choice*
→ toggle **Required**.)

---

## 4. The two numbers to keep honest

**Reserve tracker** — in `index.html`, near the bottom `<script>`:

```js
const LOCKED = 17;   // <-- current builders locked in
const GOAL   = 50;   // <-- threshold to confirm the cohort
```

Change `LOCKED` (and `GOAL` if you retune the threshold) and the bar + % update
automatically. Set `LOCKED` to your real count before publishing.

**Vote seeds** — either the on-page `data-votes="…"` values (local mode) or the
`SEED = {…}` object in the function (real mode). Start truthful.

---

## Quick launch checklist

- [ ] Two Stripe Payment Links created and pasted into the Reserve buttons
- [ ] Deposit refund/credit terms reviewed by someone you trust
- [ ] Vote backend deployed (A or B) **or** poll linked out (C); `VOTE_API` set
- [ ] Reserve tracker `LOCKED` set to the real number
- [ ] Vote seed numbers set to something true
- [ ] Format + destination questions added to the Google Form
- [ ] `robots.txt` / `sitemap.xml` still valid, GA + Clarity firing
