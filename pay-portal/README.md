# Pay.TechDreamAfrica.org — Client Payment Portal

A responsive payment portal built with **HTML, Tailwind CSS (CDN), vanilla
JavaScript (ES modules), Chart.js, jsPDF, and Supabase** (Auth, Postgres,
Storage, Realtime, Edge Functions, RLS) — integrated with the **Hubtel
Collection API** for Mobile Money and card payments in Ghana.

## The most important design decision

**Hubtel credentials never touch the browser.** Every call to Hubtel happens
inside a Supabase Edge Function running with server-side secrets. The
frontend only ever talks to Supabase (`supabase.functions.invoke(...)`) —
see `js/payments.js`. This is not optional hardening; it's the only way to
use Hubtel's Basic Auth (Client ID + Secret) safely from a static site.

## What's included

| Area | Status |
|---|---|
| Landing page matching techdreamafrica.org's visual language (flat colors, no gradients, photo hero with solid overlay) | ✅ Complete |
| Auth: register, login, forgot/reset password, remember me, logout, role-based access | ✅ Complete |
| Payment flow: pay by invoice number, project deposit lookup, custom payment | ✅ Complete |
| Payment form: name, email, phone, network/card, amount, purpose | ✅ Complete |
| **3 Edge Functions**: `hubtel-initiate-payment`, `hubtel-check-status`, `hubtel-webhook` — with idempotency, server-side re-verification, and an optional webhook-secret check | ✅ Complete |
| Live payment status page (client-side polling against `hubtel-check-status`) | ✅ Complete |
| Digital receipt: view, print, download as PDF (jsPDF + html2canvas) | ✅ Complete |
| Email receipt | ⚪ Stubbed with a clear message — needs an Edge Function + email provider (Resend/Postmark/SES); see "Next steps" |
| Client dashboard: total paid, outstanding balance, pending payments, invoices, transaction history | ✅ Complete |
| Finance/Admin dashboard: revenue cards, Chart.js revenue-by-month + payment-method charts, searchable transaction table | ✅ Complete |
| Full SQL schema, RLS policies, DB triggers (auto-receipt + invoice balance update on success, in-app notifications on status change) | ✅ Complete |
| Dark/light mode, toasts, modals, skeleton loaders | ✅ Complete |
| Refunds, CSV/Excel export, SMS notifications | ⚪ Not included — see "Next steps" |

This is a real, working scaffold — every Hubtel call, every Supabase query,
is wired to actually run once you supply your credentials.

## 1. Create your Supabase project

1. [supabase.com](https://supabase.com) → New Project.
2. **SQL Editor** → run all of [`sql/schema.sql`](sql/schema.sql). This creates
   every table, enum, RLS policy, trigger, the `get_invoice_for_payment` RPC,
   and the `receipts` storage bucket.
3. **Project Settings → API** → copy your **Project URL** and **anon key**.

## 2. Connect the frontend

Edit `js/supabase.js`:

```js
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
```

## 3. Get your Hubtel credentials

From the [Hubtel Merchant Dashboard](https://hubtel.com):
1. Create a Collections / Receive Money account if you don't have one.
2. Note your **Client ID**, **Client Secret**, and **Merchant Account
   Number / Merchant Account ID** (these are separate from the ID/Secret).

## 4. Deploy the Edge Functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF

# Secrets — set once, shared across all three functions
supabase secrets set \
  HUBTEL_CLIENT_ID=your_client_id \
  HUBTEL_CLIENT_SECRET=your_client_secret \
  HUBTEL_MERCHANT_ACCOUNT_NUMBER=your_merchant_account_number \
  HUBTEL_MERCHANT_ACCOUNT_ID=your_merchant_account_id \
  HUBTEL_WEBHOOK_SECRET=$(openssl rand -hex 24) \
  SITE_URL=https://pay.techdreamafrica.org \
  ALLOWED_ORIGIN=https://pay.techdreamafrica.org

# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
# the platform for every Edge Function — you don't set those yourself.

supabase functions deploy hubtel-initiate-payment
supabase functions deploy hubtel-check-status
supabase functions deploy hubtel-webhook --no-verify-jwt
```

`--no-verify-jwt` on the webhook is required: Hubtel calls that endpoint
directly, with no Supabase session, so it can't present a Supabase JWT. The
function is instead protected by `HUBTEL_WEBHOOK_SECRET` (see
`verifyWebhookAuth()` in `_shared/hubtel.ts`) plus a mandatory server-side
re-check against Hubtel's status API before it trusts any payload.

## 5. Register the webhook URL with Hubtel

Your webhook endpoint is:
```
https://YOUR-PROJECT-REF.functions.supabase.co/hubtel-webhook?secret=YOUR_HUBTEL_WEBHOOK_SECRET
```
Set this as the `callbackUrl` (already done automatically by
`hubtel-initiate-payment`) and, if your Hubtel account supports a static
webhook registration, add the same URL in the Hubtel dashboard.

## 6. Enable email auth

**Authentication → URL Configuration**: set Site URL to your domain and add
`/login.html` and `/reset-password.html` as redirect URLs.

## 7. Run locally

```bash
cd pay-portal
python3 -m http.server 8080
```

ES modules require serving over HTTP, not `file://`.

## 8. Project structure

```
/index.html         Landing page
/login.html          Login + forgot password
/register.html       Registration
/reset-password.html Password reset landing
/dashboard.html      Client / Finance-Admin dashboard (role-aware)
/pay.html            3-option payment flow + Hubtel initiation + live status
/invoice.html        Standalone invoice lookup
/receipt.html        Digital receipt: view, print, download PDF
/profile.html        Profile + password management

/assets/css/style.css  Fonts, flat brand colors (no gradients), print styles

/js/
  supabase.js          Client singleton + auth guards
  auth.js               Register / login / logout / password reset
  invoices.js            Invoice lookup (RPC) + listing
  payments.js             Calls Edge Functions, polls status, history
  dashboard.js             Client + finance stat rendering
  ui.js                     Toasts, modals, theme, skeletons, money formatting

/components/          Reference markup for navbar/sidebar/footer

/sql/schema.sql        Tables, enums, RLS, triggers, storage policies,
                        get_invoice_for_payment() RPC

/supabase/edge-functions/
  _shared/
    cors.ts              CORS headers
    supabaseAdmin.ts      Service-role client (Edge Functions only)
    hubtel.ts              Hubtel API client + webhook auth check
  hubtel-initiate-payment/  Validates input, re-checks invoice balance
                              server-side, creates the payment row, calls
                              Hubtel Receive Money, updates status
  hubtel-check-status/       Polled by the browser while a payment is
                              "processing"; re-syncs from Hubtel's API
  hubtel-webhook/             Receives Hubtel's async confirmation,
                              verifies it, re-checks with Hubtel's status
                              API before trusting it, updates the payment
                              (idempotent — ignores already-terminal rows)
```

## 9. How the payment flow works end-to-end

1. Client fills the payment form on `pay.html` → `initiatePayment()` in
   `js/payments.js` calls `hubtel-initiate-payment`.
2. That function validates the request, re-checks the invoice balance
   server-side (never trusts the amount from the browser blindly for
   invoice payments), inserts a `payments` row with `status: 'pending'`
   and a unique `client_reference` (our idempotency key), then calls
   Hubtel's Receive Money endpoint.
3. Hubtel pushes a USSD/STK prompt to the payer's phone (or hosts a card
   page). The browser starts polling `hubtel-check-status` every few
   seconds via `pollPaymentStatus()`.
4. When the payer approves, Hubtel calls `hubtel-webhook` asynchronously.
   The function verifies the shared secret, **re-verifies the transaction
   status directly with Hubtel's API** (defense in depth against a spoofed
   callback), and updates the `payments` row.
5. A Postgres trigger (`on_payment_success`) fires automatically: generates
   a `receipts` row, reduces the invoice `balance`, and flips its `status`
   to `paid`/`partially_paid`. Another trigger creates an in-app
   notification for the client.
6. The browser's poll (or the webhook's realtime update, since `payments`
   is in the Realtime publication) picks up the terminal status and shows
   the receipt.

**Idempotency** is enforced two ways: the unique `client_reference` per
attempt, and both the webhook and the status-check function no-op if the
payment is already in a terminal state (`successful`/`failed`/`cancelled`/
`refunded`) before writing anything.

## 10. Design tokens (matches techdreamafrica.org — flat, no gradients)

| Token | Hex |
|---|---|
| Primary (Teal) | `#0F766E` |
| Secondary (Slate) | `#1E293B` |
| Accent (Blue) | `#2563EB` |
| Success | `#10B981` |
| Warning | `#F59E0B` |
| Error | `#EF4444` |

Every button, badge, and surface in this build uses a single solid color —
no `bg-gradient-to-*` utilities anywhere, including the hero (a flat dark
overlay on a photo, not a mesh gradient).

## 11. Extending toward full production readiness

- **Refunds**: Hubtel's refund support varies by plan/product — add a
  `hubtel-refund` Edge Function following the same pattern once you confirm
  your account has refund access, and add `status: 'refunded'` handling.
- **CSV/Excel export**: add a "Export" button on the finance dashboard that
  builds a CSV client-side from the already-fetched `payments` array (no
  new backend needed — SheetJS works great here).
- **SMS notifications**: wire a `notify-sms` Edge Function using a Ghanaian
  SMS gateway (Hubtel also offers SMS) triggered from the same DB trigger
  that creates in-app notifications, or via a Postgres `pg_net` call.
- **Email receipts**: the `email-btn` on `receipt.html` is stubbed —
  build an Edge Function that renders the receipt (reuse the same data)
  and sends via Resend/Postmark/SES.
- **Audit log viewer**: `audit_logs` is already populated by every Edge
  Function — just needs an admin-only table UI.
- **Rate limiting**: add Supabase's built-in Edge Function rate limiting or
  a simple per-IP/per-email counter table for `hubtel-initiate-payment` to
  prevent abuse.
