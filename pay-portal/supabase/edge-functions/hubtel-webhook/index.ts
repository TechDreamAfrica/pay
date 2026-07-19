// ============================================================================
// POST /functions/v1/hubtel-webhook
//
// Hubtel calls this URL asynchronously when a payment settles (or fails).
// This is the authoritative source of truth for payment status — never
// trust the browser's redirect alone to mark something "paid".
//
// Configure this exact URL as the `callbackUrl` sent in every
// hubtel-initiate-payment request, AND register it in the Hubtel merchant
// dashboard if your account requires a static webhook URL.
// ============================================================================
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { verifyWebhookAuth, checkTransactionStatus } from '../_shared/hubtel.ts';

const HUBTEL_TO_INTERNAL_STATUS: Record<string, string> = {
  Success: 'successful',
  Paid: 'successful',
  Pending: 'processing',
  Unpaid: 'failed',
  Failed: 'failed',
  Cancelled: 'cancelled',
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  // ---- Verify the caller is actually Hubtel (or our configured secret) -----
  if (!verifyWebhookAuth(req)) {
    console.warn('Webhook auth failed — rejecting.');
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await req.json();
    // Hubtel's callback shape varies by product; the two fields we rely on
    // are ClientReference and Status. Adjust field names to match your
    // Hubtel account's actual webhook payload (check the dashboard's
    // "Test Webhook" tool) — this is written defensively against a couple
    // of known shapes.
    const clientReference = payload?.Data?.ClientReference ?? payload?.ClientReference ?? payload?.clientReference;
    const hubtelStatus = payload?.Data?.Status ?? payload?.Status ?? payload?.status;
    const hubtelTransactionId = payload?.Data?.TransactionId ?? payload?.TransactionId;

    if (!clientReference) {
      return jsonResponse({ error: 'Missing ClientReference in payload.' }, 400);
    }

    const supabase = getSupabaseAdmin();
    const { data: payment, error } = await supabase
      .from('payments').select('*').eq('client_reference', clientReference).single();

    if (error || !payment) {
      console.warn('Webhook for unknown clientReference:', clientReference);
      return jsonResponse({ error: 'Unknown transaction.' }, 404);
    }

    // ---- Idempotency guard --------------------------------------------------
    // If we've already recorded a terminal state, don't process again —
    // Hubtel (like most providers) may retry webhook delivery.
    if (['successful', 'failed', 'cancelled', 'refunded'].includes(payment.status)) {
      return jsonResponse({ received: true, note: 'Already processed.' });
    }

    // ---- Defense in depth: re-verify with Hubtel's status API rather than
    // trusting the webhook body alone (protects against a spoofed or
    // malformed callback even if HUBTEL_WEBHOOK_SECRET isn't configured). --
    let confirmedStatus = HUBTEL_TO_INTERNAL_STATUS[hubtelStatus] ?? 'processing';
    try {
      const verification = await checkTransactionStatus(clientReference);
      const verifiedMapped = HUBTEL_TO_INTERNAL_STATUS[verification?.data?.status];
      if (verifiedMapped) confirmedStatus = verifiedMapped;
    } catch (verifyErr) {
      console.warn('Could not re-verify with Hubtel status API, trusting webhook body.', verifyErr);
    }

    const { error: updateErr } = await supabase
      .from('payments')
      .update({
        status: confirmedStatus,
        hubtel_transaction_id: hubtelTransactionId ?? payment.hubtel_transaction_id,
        raw_webhook_payload: payload,
      })
      .eq('id', payment.id)
      .eq('status', payment.status); // optimistic lock — no-op if already changed concurrently

    if (updateErr) {
      console.error('Failed to update payment from webhook', updateErr);
      return jsonResponse({ error: 'Failed to update payment.' }, 500);
    }

    await supabase.from('audit_logs').insert({
      actor: 'system:hubtel-webhook', action: 'webhook.received', entity_type: 'payment',
      entity_id: payment.id, metadata: { clientReference, hubtelStatus, confirmedStatus },
    });

    // The `on_payment_success` DB trigger (see sql/schema.sql) handles
    // receipt generation + invoice balance updates automatically when
    // status flips to 'successful'; the `on_payment_status_change` trigger
    // creates the in-app notification. Nothing further to do here.

    return jsonResponse({ received: true, status: confirmedStatus });
  } catch (err) {
    console.error('Webhook processing error', err);
    return jsonResponse({ error: 'Webhook processing failed.' }, 500);
  }
});
