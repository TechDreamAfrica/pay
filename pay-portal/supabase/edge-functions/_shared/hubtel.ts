// ============================================================================
// Hubtel Collection API client. Credentials are read from Edge Function
// secrets (set via `supabase secrets set`) and NEVER touch the browser.
//
// Docs: https://developers.hubtel.com/docs/collections-overview
// ============================================================================

const HUBTEL_BASE_URL = 'https://rmp.hubtel.com/v1';

function authHeader(): string {
  const clientId = Deno.env.get('HUBTEL_CLIENT_ID')!;
  const clientSecret = Deno.env.get('HUBTEL_CLIENT_SECRET')!;
  return 'Basic ' + btoa(`${clientId}:${clientSecret}`);
}

export interface HubtelReceiveMoneyRequest {
  amount: number;
  title: string;               // short description shown to the payer
  description: string;
  clientReference: string;     // OUR idempotency key
  callbackUrl: string;         // the hubtel-webhook Edge Function URL
  returnUrl: string;           // where the browser redirects after payment
  cancellationUrl: string;
  merchantAccountNumber: string;
  payeeName: string;
  payeeMobileNumber: string;
  payeeEmail?: string;
  channel: 'mtn-gh' | 'vodafone-gh' | 'tigo-gh' | 'visa' | 'mastercard';
}

// Initiates a "Receive Money" request — Hubtel pushes a USSD/STK prompt to
// the payer's phone for mobile money, or hosts a card page and calls our
// callbackUrl asynchronously either way.
export async function initiateReceiveMoney(payload: HubtelReceiveMoneyRequest) {
  const merchantAccountId = Deno.env.get('HUBTEL_MERCHANT_ACCOUNT_ID')!;
  const res = await fetch(`${HUBTEL_BASE_URL}/merchantaccount/merchants/${merchantAccountId}/receive/mobilemoney`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Hubtel initiate failed with status ${res.status}`);
  }
  return data;
}

// Polls the status of a previously-initiated transaction by clientReference.
export async function checkTransactionStatus(clientReference: string) {
  const merchantAccountId = Deno.env.get('HUBTEL_MERCHANT_ACCOUNT_ID')!;
  const res = await fetch(
    `${HUBTEL_BASE_URL}/merchantaccount/merchants/${merchantAccountId}/transactions/status?clientReference=${encodeURIComponent(clientReference)}`,
    { headers: { Authorization: authHeader() } }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Hubtel status check failed with status ${res.status}`);
  }
  return data;
}

// Hubtel webhook payloads don't carry a documented HMAC signature in all
// plans — if your Hubtel account provides a shared webhook secret / basic
// auth on the callback URL, verify it here. This defends against spoofed
// callbacks even if you also re-check status via the API (belt & suspenders).
export function verifyWebhookAuth(req: Request): boolean {
  const expected = Deno.env.get('HUBTEL_WEBHOOK_SECRET');
  if (!expected) return true; // no secret configured — skip (not recommended for prod)
  const provided = req.headers.get('x-webhook-secret') ?? new URL(req.url).searchParams.get('secret');
  return provided === expected;
}
