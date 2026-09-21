# EMIFlow v2.0 — Plan Today, Peace Tomorrow ☁️

Cloud-synced EMI / loan-installment tracker PWA. Live: **https://emiflow.pages.dev**

## Architecture (the TELLY-X pattern)
- **Single-file PWA** (`index.html`) — vanilla JS, no framework, ~66 KB
- **Cloudflare Pages Advanced Mode** — `_worker.js` serves the API + static assets
- **Turso (libsql)** over HTTP v2 pipelines — fully batched (max 1–2 DB round trips per request)
- **Offline-first sync** — local-first writes, outbox queue, cursor-based pull/push (LWW), works across devices

## Security
- Passwords: random salt + **PBKDF2-SHA256 · 100k iterations** (WebCrypto)
- Sessions: 64-hex bearer tokens in DB, 180-day expiry, revocable (`logout`, `logout-all`)
- Login rate-limiting: 8 fails / 15 min / (IP ∪ email)
- DB credential lives only in encrypted Pages secret `DB_TOKEN` — never in the repo
- SW never caches `/api/*`; export + full account delete (GDPR-style) included

## Features
- Add EMI: name, **real lender icons** (Bajaj, Paytm, PhonePe, GPay, CRED, Amazon Pay, Navi, KreditBee, MoneyView, LazyPay, Simpl, HDFC, ICICI, SBI, Axis + Other), category, amount, installments, first due date, paid count, autopay flag, reminder window, notes
- Home: due-this-month hero, outstanding/paid/overdue summary, next due, loan cards with progress
- Reports: 6-month outflow projection, lender-wise + category-wise outstanding
- Calendar: month grid with due dots (overdue/due), day drill-down
- Reminders: Web Notifications + in-app urgent banner
- Profile: theme (system/light/dark), animations, sync status, JSON export, logout-all, delete account

## Dev / Deploy
```bash
npx wrangler pages secret put DB_TOKEN --project-name emiflow   # Turso DB JWT
npx wrangler pages deploy . --project-name emiflow --branch main
```
Local: any static server (API needs the Pages env).

*All lender logos are trademarks of their respective owners, used as visual tags only.*
