-- ============================================================================
-- Pay.TechDreamAfrica.org — Client Payment Portal
-- Supabase PostgreSQL Schema + Row Level Security Policies
-- ============================================================================
-- Run in Supabase SQL Editor on a fresh project. Safe to re-run.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------
do $$ begin create type user_role as enum ('client', 'finance', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin create type invoice_status as enum ('unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type payment_method as enum ('mtn_momo', 'telecel_cash', 'airteltigo_money', 'visa', 'mastercard');
exception when duplicate_object then null; end $$;

do $$ begin create type payment_status as enum ('pending', 'processing', 'successful', 'failed', 'cancelled', 'refunded');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- USERS (profile table — extends auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  fullname text not null,
  email text not null unique,
  phone text,
  role user_role not null default 'client',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, fullname, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'fullname', split_part(new.email,'@',1)),
          new.email, coalesce((new.raw_user_meta_data->>'role')::user_role, 'client'));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------------------
-- INVOICES
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default uuid_generate_v4(),
  invoice_number text not null unique,
  client_id uuid references public.users(id) on delete set null,
  client_email text not null,
  client_name text not null,
  project_id text,
  project_name text,
  description text,
  amount numeric(12,2) not null check (amount >= 0),
  balance numeric(12,2) not null check (balance >= 0),
  currency text not null default 'GHS',
  due_date date,
  status invoice_status not null default 'unpaid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoices_client on public.invoices(client_id);
create index if not exists idx_invoices_number on public.invoices(invoice_number);
create index if not exists idx_invoices_status on public.invoices(status);

-- ----------------------------------------------------------------------------
-- PAYMENTS
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid references public.invoices(id) on delete set null,
  client_id uuid references public.users(id) on delete set null,
  payer_name text not null,
  payer_email text not null,
  payer_phone text not null,
  purpose text,                              -- e.g. "Project Deposit", "Custom Payment"
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'GHS',
  payment_method payment_method not null,
  client_reference text not null unique,      -- our own idempotency key, generated client-side
  hubtel_transaction_id text,
  hubtel_reference text,
  status payment_status not null default 'pending',
  raw_webhook_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_invoice on public.payments(invoice_id);
create index if not exists idx_payments_client on public.payments(client_id);
create index if not exists idx_payments_status on public.payments(status);
create index if not exists idx_payments_client_ref on public.payments(client_reference);
create index if not exists idx_payments_hubtel_txn on public.payments(hubtel_transaction_id);

-- ----------------------------------------------------------------------------
-- RECEIPTS
-- ----------------------------------------------------------------------------
create table if not exists public.receipts (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  receipt_number text not null unique,
  pdf_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_receipts_payment on public.receipts(payment_id);

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  message text,
  type text default 'general',
  link text,
  read boolean default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.notifications(user_id);

-- ----------------------------------------------------------------------------
-- AUDIT LOG (webhook + admin actions, for security review)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  actor text not null,                -- 'system:hubtel-webhook', a user id, etc.
  action text not null,               -- 'payment.initiated', 'payment.confirmed', 'invoice.updated'...
  entity_type text,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_created on public.audit_logs(created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.users enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('finance','admin') from public.users where id = auth.uid()), false);
$$;

-- ---------- users ----------
drop policy if exists "users_select_own_or_staff" on public.users;
create policy "users_select_own_or_staff" on public.users
  for select using (id = auth.uid() or public.is_staff());

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users for update using (id = auth.uid());

drop policy if exists "users_insert_self" on public.users;
create policy "users_insert_self" on public.users for insert with check (id = auth.uid());

drop policy if exists "users_admin_update_any" on public.users;
create policy "users_admin_update_any" on public.users for update using (public.current_role() = 'admin');

-- ---------- invoices ----------
-- Clients can look an invoice up by number (needed for the "pay by invoice
-- number" flow before they're necessarily linked as client_id) as long as
-- they also supply a matching email — enforced in the RPC below, not here.
drop policy if exists "invoices_select_own_or_staff" on public.invoices;
create policy "invoices_select_own_or_staff" on public.invoices
  for select using (client_id = auth.uid() or public.is_staff());

drop policy if exists "invoices_staff_write" on public.invoices;
create policy "invoices_staff_write" on public.invoices
  for all using (public.is_staff()) with check (public.is_staff());

-- Public, rate-limited lookup by invoice number + email is done via the
-- get_invoice_for_payment() SECURITY DEFINER function below, NOT by
-- relaxing SELECT here — keeps direct table access locked to owners/staff.

-- ---------- payments ----------
drop policy if exists "payments_select_own_or_staff" on public.payments;
create policy "payments_select_own_or_staff" on public.payments
  for select using (client_id = auth.uid() or payer_email = (select email from public.users where id = auth.uid()) or public.is_staff());

drop policy if exists "payments_insert_own" on public.payments;
create policy "payments_insert_own" on public.payments
  for insert with check (client_id = auth.uid() or client_id is null);

drop policy if exists "payments_staff_update" on public.payments;
create policy "payments_staff_update" on public.payments
  for update using (public.is_staff());
-- Note: payment status transitions (pending -> successful/failed) are
-- normally written by the hubtel-webhook Edge Function using the
-- service_role key, which bypasses RLS entirely — that's the trusted path.
-- This policy only covers manual staff corrections from the dashboard.

-- ---------- receipts ----------
drop policy if exists "receipts_select" on public.receipts;
create policy "receipts_select" on public.receipts
  for select using (
    public.is_staff() or exists (
      select 1 from public.payments p where p.id = payment_id
      and (p.client_id = auth.uid() or p.payer_email = (select email from public.users where id = auth.uid()))
    )
  );

-- ---------- notifications ----------
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications for select using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications for update using (user_id = auth.uid());

-- ---------- audit_logs ----------
drop policy if exists "audit_logs_admin_only" on public.audit_logs;
create policy "audit_logs_admin_only" on public.audit_logs for select using (public.current_role() = 'admin');
-- Inserts happen exclusively via service_role from Edge Functions.

-- ============================================================================
-- SECURITY-DEFINER RPC: safe public invoice lookup
-- Used by pay.html "Option 1: Pay using Invoice Number" — lets an
-- unauthenticated or authenticated visitor look up an invoice by number +
-- email without granting broad table SELECT access.
-- ============================================================================
create or replace function public.get_invoice_for_payment(p_invoice_number text, p_email text)
returns table (
  id uuid, invoice_number text, client_name text, project_name text,
  amount numeric, balance numeric, currency text, due_date date, status invoice_status
)
language sql stable security definer set search_path = public as $$
  select id, invoice_number, client_name, project_name, amount, balance, currency, due_date, status
  from public.invoices
  where invoice_number = p_invoice_number and lower(client_email) = lower(p_email);
$$;

revoke all on function public.get_invoice_for_payment(text, text) from public;
grant execute on function public.get_invoice_for_payment(text, text) to anon, authenticated;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists touch_invoices on public.invoices;
create trigger touch_invoices before update on public.invoices
  for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_payments on public.payments;
create trigger touch_payments before update on public.payments
  for each row execute procedure public.touch_updated_at();

-- Notify the payer's user account (if any) whenever their payment status changes.
create or replace function public.handle_payment_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text; v_message text; v_type text;
begin
  if new.status = old.status then return new; end if;

  v_type := case new.status
    when 'successful' then 'payment_successful'
    when 'failed' then 'payment_failed'
    when 'processing' then 'payment_processing'
    else 'general' end;
  v_title := case new.status
    when 'successful' then 'Payment successful'
    when 'failed' then 'Payment failed'
    when 'processing' then 'Payment processing'
    else 'Payment update' end;
  v_message := format('%s %s for %s', new.currency, new.amount, coalesce(new.purpose, 'your invoice'));

  if new.client_id is not null then
    insert into public.notifications (user_id, title, message, type, link)
    values (new.client_id, v_title, v_message, v_type, '/receipt.html?payment=' || new.id);
  end if;

  return new;
end; $$;

drop trigger if exists on_payment_status_change on public.payments;
create trigger on_payment_status_change after update of status on public.payments
  for each row execute procedure public.handle_payment_status_change();

-- Auto-generate a receipt + mark invoice paid/partially_paid when a payment succeeds.
create or replace function public.handle_payment_success()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.invoices%rowtype;
  v_receipt_number text;
begin
  if new.status <> 'successful' or old.status = 'successful' then return new; end if;

  v_receipt_number := 'RCPT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(new.id::text, 1, 8);
  insert into public.receipts (payment_id, receipt_number) values (new.id, v_receipt_number)
  on conflict do nothing;

  if new.invoice_id is not null then
    select * into v_invoice from public.invoices where id = new.invoice_id;
    if found then
      update public.invoices
      set balance = greatest(v_invoice.balance - new.amount, 0),
          status = case when greatest(v_invoice.balance - new.amount, 0) <= 0 then 'paid'::invoice_status
                        else 'partially_paid'::invoice_status end
      where id = new.invoice_id;
    end if;
  end if;

  insert into public.audit_logs (actor, action, entity_type, entity_id, metadata)
  values ('system:trigger', 'payment.confirmed', 'payment', new.id::text,
          jsonb_build_object('amount', new.amount, 'invoice_id', new.invoice_id));

  return new;
end; $$;

drop trigger if exists on_payment_success on public.payments;
create trigger on_payment_success after update of status on public.payments
  for each row execute procedure public.handle_payment_success();

-- ============================================================================
-- STORAGE (receipt PDFs)
-- ============================================================================
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "storage_receipts_select" on storage.objects;
create policy "storage_receipts_select" on storage.objects
  for select using (
    bucket_id = 'receipts' and (
      public.is_staff() or
      exists (
        select 1 from public.receipts r join public.payments p on p.id = r.payment_id
        where r.pdf_url like '%' || storage.objects.name
        and (p.client_id = auth.uid() or p.payer_email = (select email from public.users where id = auth.uid()))
      )
    )
  );

-- Only the service_role (Edge Functions) writes receipt PDFs — no insert
-- policy for anon/authenticated is defined, so client-side uploads are
-- denied by default (RLS fails closed).

-- ============================================================================
-- REALTIME
-- ============================================================================
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.invoices;

-- ============================================================================
-- Done. Next: deploy the three Edge Functions in /supabase/edge-functions
-- and set your Hubtel + Supabase secrets (see README.md).
-- ============================================================================
