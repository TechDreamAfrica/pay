// ============================================================================
// POST /functions/v1/hubtel-initiate-payment
//
// Called by the browser (payments.js) with the payment form data. This is
// the ONLY place a mobile-money/card push request gets created — it runs
// server-side so Hubtel credentials stay out of client JS.
//
// Body: {
//   invoiceId?: string, projectId?: string, purpose: string,
//   fullName: string, email: string, phone: string,
//   amount: number, currency: 'GHS', paymentMethod: 'mtn_momo'|'telecel_cash'|'airteltigo_money'|'visa'|'mastercard'
// }
// ============================================================================
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { initiateReceiveMoney } from '../_shared/hubtel.ts';

const CHANNEL_MAP: Record<string, string> = {
  mtn_momo: 'mtn-gh',
  telecel_cash: 'vodafone-gh',
  airteltigo_money: 'tigo-gh',
  visa: 'visa',
  mastercard: 'mastercard',
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const { invoiceId, purpose, fullName, email, phone, amount, currency = 'GHS', paymentMethod } = body;

    // ---- Basic input validation -------------------------------------------
    if (!fullName || !email || !phone || !amount || !paymentMethod) {
      return jsonResponse({ error: 'Missing required fields.' }, 400);
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return jsonResponse({ error: 'Invalid amount.' }, 400);
    }
    const channel = CHANNEL_MAP[paymentMethod];
    if (!channel) return jsonResponse({ error: 'Unsupported payment method.' }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return jsonResponse({ error: 'Invalid email.' }, 400);

    const supabase = getSupabaseAdmin();

    // ---- Resolve the caller's user id (if authenticated) -------------------
    let clientId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const { data: userData } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      clientId = userData?.user?.id ?? null;
    }

    // ---- If paying an invoice, re-validate its balance server-side --------
    if (invoiceId) {
      const { data: invoice, error: invErr } = await supabase
        .from('invoices').select('id, balance, status').eq('id', invoiceId).single();
      if (invErr || !invoice) return jsonResponse({ error: 'Invoice not found.' }, 404);
      if (invoice.status === 'paid' || invoice.status === 'cancelled') {
        return jsonResponse({ error: 'This invoice is not payable.' }, 400);
      }
      if (amount > Number(invoice.balance)) {
        return jsonResponse({ error: 'Amount exceeds the outstanding balance.' }, 400);
      }
    }

    // ---- Idempotency key: one row per attempt, unique client_reference ----
    const clientReference = `TDA-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const { data: payment, error: insertErr } = await supabase
      .from('payments')
      .insert({
        invoice_id: invoiceId ?? null,
        client_id: clientId,
        payer_name: fullName,
        payer_email: email,
        payer_phone: phone,
        purpose: purpose ?? 'Payment',
        amount,
        currency,
        payment_method: paymentMethod,
        client_reference: clientReference,
        status: 'pending',
      })
      .select()
      .single();

    if (insertErr) {
      console.error('DB insert error', insertErr);
      return jsonResponse({ error: 'Could not create payment record.' }, 500);
    }

    // ---- Call Hubtel --------------------------------------------------------
    const origin = Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.functions.supabase.co');
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://pay.techdreamafrica.org';

    try {
      const hubtelResponse = await initiateReceiveMoney({
        amount,
        title: purpose ?? 'TechDream Africa Payment',
        description: `Payment for ${purpose ?? 'services'} — ref ${clientReference}`,
        clientReference,
        callbackUrl: `${origin}/hubtel-webhook`,
        returnUrl: `${siteUrl}/receipt.html?ref=${clientReference}`,
        cancellationUrl: `${siteUrl}/pay.html?cancelled=1`,
        merchantAccountNumber: Deno.env.get('HUBTEL_MERCHANT_ACCOUNT_NUMBER')!,
        payeeName: fullName,
        payeeMobileNumber: phone,
        payeeEmail: email,
        channel: channel as any,
      });

      await supabase.from('payments').update({
        status: 'processing',
        hubtel_transaction_id: hubtelResponse.data?.transactionId ?? null,
        hubtel_reference: hubtelResponse.data?.hubtelReference ?? null,
      }).eq('id', payment.id);

      await supabase.from('audit_logs').insert({
        actor: clientId ?? email, action: 'payment.initiated', entity_type: 'payment',
        entity_id: payment.id, metadata: { clientReference, amount, paymentMethod },
      });

      return jsonResponse({
        success: true,
        paymentId: payment.id,
        clientReference,
        hubtel: hubtelResponse.data,
      });
    } catch (hubtelErr) {
      console.error('Hubtel error', hubtelErr);
      await supabase.from('payments').update({ status: 'failed' }).eq('id', payment.id);
      return jsonResponse({ error: 'Payment provider error. Please try again.' }, 502);
    }
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: 'Unexpected server error.' }, 500);
  }
});
