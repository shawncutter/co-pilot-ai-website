# Co-Pilots AI — Cloudflare Pages Deployment Guide

## Folder Structure

```
co-pilot.ai-website.ai/
  index.html      ← Main website (single-file, all CSS/JS inlined)
  404.html         ← Custom 404 page
  _headers         ← Security headers + cache rules
  _redirects       ← www→apex redirect + SPA fallback
  robots.txt       ← Search engine crawl rules
  sitemap.xml      ← Sitemap for SEO
  DEPLOY.md        ← This file (not deployed)
```

## Step 1: Create Cloudflare Pages Project

1. Log into **Cloudflare Dashboard** → Pages
2. Click **Create a project** → **Direct Upload**
3. Name the project: `co-pilot-ai`
4. Drag the contents of this folder (all files except DEPLOY.md) into the upload area
5. Click **Deploy site**

Your site will be live at `co-pilot-ai.pages.dev` within ~60 seconds.

## Step 2: Connect Custom Domain (co-pilot.ai)

### If your domain is already on Cloudflare DNS:
1. In the Pages project → **Custom domains** tab
2. Click **Set up a custom domain**
3. Enter `co-pilot.ai`
4. Cloudflare auto-creates the required CNAME/A records
5. Repeat for `www.co-pilot.ai`

### If your domain is with another registrar:
1. In the Pages project → **Custom domains** tab
2. Add `co-pilot.ai` and `www.co-pilot.ai`
3. Cloudflare will show the required DNS records
4. At your registrar, add these DNS records:
   - **Type:** CNAME
   - **Name:** `@` (or `co-pilot.ai`)
   - **Target:** `co-pilot-ai.pages.dev`
   - **TTL:** Auto
   
   And:
   - **Type:** CNAME
   - **Name:** `www`
   - **Target:** `co-pilot-ai.pages.dev`
   - **TTL:** Auto

5. Wait for DNS propagation (usually 5-30 minutes, can take up to 48 hours)

### Better option — move DNS to Cloudflare:
1. Add `co-pilot.ai` to your Cloudflare account (Free plan)
2. Cloudflare gives you nameservers (e.g., `ada.ns.cloudflare.com`)
3. At your domain registrar, update nameservers to Cloudflare's
4. Wait for propagation
5. Then do the Pages custom domain setup above (auto-creates records)

## Step 3: SSL/TLS

Cloudflare Pages provides free SSL automatically. No config needed. Your site will be HTTPS by default.

If you moved DNS to Cloudflare, go to **SSL/TLS** in the dashboard and set mode to **Full (strict)**.

## Step 4: Wire Up Form Submissions

The application form currently uses an email fallback (opens a `mailto:` link). To enable direct submissions:

### Option A: Formspree (Recommended — free tier: 50 submissions/month)
1. Go to https://formspree.io and create a free account
2. Create a new form → copy the endpoint URL (looks like `https://formspree.io/f/xABCDEFG`)
3. In `index.html`, find this line near the bottom:
   ```js
   const FORM_ENDPOINT = "";
   ```
4. Replace with your endpoint:
   ```js
   const FORM_ENDPOINT = "https://formspree.io/f/xABCDEFG";
   ```
5. Re-upload the updated `index.html` to Cloudflare Pages

### Option B: Cloudflare Workers (more control, free tier)
- Set up a Worker that receives POST data and forwards to email/Airtable/Notion
- Requires more setup but gives you full control

## Step 5: Future Updates

### Direct Upload (simplest):
1. Edit `index.html` locally
2. Go to Cloudflare Pages → your project → **Create new deployment**
3. Upload the updated files
4. New version is live in ~30 seconds

### Git Integration (recommended for ongoing changes):
1. Push this folder to a GitHub/GitLab repo
2. In Cloudflare Pages, reconnect the project to the repo
3. Set build command to empty (no build needed — it's static HTML)
4. Set output directory to `/` (root)
5. Every push to `main` auto-deploys

## Go-Live Checklist

- [ ] Upload all files to Cloudflare Pages
- [ ] Verify site loads at `*.pages.dev` URL
- [ ] Connect `co-pilot.ai` custom domain
- [ ] Connect `www.co-pilot.ai` (redirects to apex)
- [ ] Verify HTTPS works
- [ ] Set up Formspree and wire the endpoint
- [ ] Test form submission end-to-end
- [ ] Submit sitemap to Google Search Console
- [ ] Test on mobile (iPhone + Android)
- [ ] Test all nav links and scroll behavior
- [ ] Verify 404 page works (visit /nonexistent)
- [ ] Share link with committee for review
