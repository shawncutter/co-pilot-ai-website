# co-pilot.ai: how the site runs

The site is a Cloudflare Worker with static assets, served at **co-pilot.ai** and
**www.co-pilot.ai** (custom domains declared in `wrangler.jsonc`). Every push to `main` deploys it
(Workers Builds, connected to this repo). Other branches get preview builds.

`coach.co-pilot.ai` is a separate Worker: the members' app (checkout, portal, briefings). Its home
page redirects here, so co-pilot.ai is the only public face.

If a deploy fails with "hostname already in use", co-pilot.ai is still attached to the old
Cloudflare Pages project: remove the custom domain there (Pages → co-pilot-ai → Custom domains),
then retry the build.

```
public/            the website, served as-is (nothing outside it is ever served)
  index.html       Home
  membership/      Membership
  founders/        Founders
  studio/          AI Factory Studio
  collective/      The Collective
  privacy/         Privacy
  404.html         Not found
  assets/          site.css and site.js (form handling)
  _headers         security headers and CSP
src/worker.js      /book/* links and the /api/lead endpoint
wrangler.jsonc     Worker config, vars, and the list of secrets
```

## Bookings go to SecondBrain

Booking buttons use short links that the Worker redirects to SecondBrain's public scheduler:

| Link | Goes to |
|---|---|
| `/book`, `/book/intro`, `/book/15` | `hey.shawncutter.com/schedule/15-minute-introduction` |
| `/book/30` | `hey.shawncutter.com/schedule/30-minute-meeting` |
| `/book/60` | `hey.shawncutter.com/schedule/60-minute-working-session` |

A booking there checks live free/busy, puts the meeting on shawn@energiacres.com's calendar, and
SecondBrain sends the confirmations and notifications. To change where a button goes, edit
`BOOKING` in `src/worker.js`.

## Sign-ups go to SecondBrain

Every form on the site (waitlist, 1:1 pricing request, founder conversation, Studio waitlist,
Collective application) posts to `/api/lead`. The Worker forwards each one:

1. **Email** to `LEAD_NOTIFY_TO` (default `shawn@energiacres.com`, the inbox SecondBrain syncs),
   sent with Resend. Reply-to is the visitor, so replying answers them directly.
2. **Signed webhook** to `SECONDBRAIN_WEBHOOK_URL`, if set. Body:
   `{"source":"co-pilot.ai","type":"lead.<kind>","lead":{...}}`. Header:
   `x-co-pilot-signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>" keyed with SECONDBRAIN_WEBHOOK_SECRET>`.
   Point it at SecondBrain's visitor-message endpoint once that is live.
3. **Backup copy** in the `LEADS` KV namespace, if bound.

A sign-up succeeds if any one of these works. If none is configured, the form says so and offers
a pre-filled email instead, so nothing is lost. Forms also work without JavaScript: the browser
posts them directly and lands on /thanks/ or /sorry/. Spam protection is a hidden honeypot field;
add Cloudflare Turnstile if spam shows up.

## One-time setup

```bash
npx wrangler login
npx wrangler secret put RESEND_API_KEY          # Resend key; co-pilot.ai must be a verified sending domain
# optional, once SecondBrain's endpoint is ready:
npx wrangler secret put SECONDBRAIN_WEBHOOK_URL
npx wrangler secret put SECONDBRAIN_WEBHOOK_SECRET
# optional backup copy of every sign-up:
npx wrangler kv namespace create LEADS          # then add the binding it prints to wrangler.jsonc
```

The sender is `LEAD_FROM` in `wrangler.jsonc` (default `Co-Pilot <hello@co-pilot.ai>`).

## Run it locally

```bash
npx wrangler dev        # http://localhost:8787
```

## Go-live checklist

- [ ] `RESEND_API_KEY` set; submit the waitlist form and see it arrive in SecondBrain
- [ ] Book a test 15-minute intro from /membership/ and see it on the calendar
- [ ] Check every page on a phone
- [ ] Replace the sample briefing on /membership/ with a real one
- [ ] Have counsel read /privacy/
- [ ] Resubmit `https://co-pilot.ai/sitemap.xml` in Google Search Console
