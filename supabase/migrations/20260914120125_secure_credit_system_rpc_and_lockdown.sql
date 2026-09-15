/*
# Secure Credit System: RPC functions, transaction expansion, and profile lockdown

1. Modified Tables
- `profiles`: Column default for `free_credits` changed from 5 to 100 so any profile created through any mechanism (trigger, backend process, or frontend signup) receives 100 free credits. No data migration needed — existing users keep their current balance.
- `credit_transactions`: Added columns `transaction_type`, `balance_before`, `source`, `description`, and `api_cost` to support the full transaction record requirements. Existing rows are backfilled with sensible defaults. The existing `mode` column is preserved for backward compatibility.

2. New RPC Functions (SECURITY DEFINER)
- `add_credits(p_user_id, p_amount, p_source, p_description)`: Atomically adds credits to a user's balance. Reads current balance, calculates balance_before and balance_after, updates the profile, inserts a credit_transaction with type 'credit_purchase' or 'free_credit', and returns the new balance. Used by the frontend purchase flow.
- `deduct_credits(p_user_id, p_amount, p_provider, p_model, p_mode, p_input_tokens, p_output_tokens, p_total_tokens, p_api_cost_usd, p_usd_to_bdt_rate, p_bdt_cost)`: Atomically deducts credits for AI usage. Locks the row with FOR UPDATE, checks for sufficient balance, rejects if insufficient, deducts from free credits first then paid credits, inserts a credit_transaction with type 'credit_usage', and returns the new balance. Two simultaneous requests cannot spend the same credits because the row lock serializes them.
- `refund_credits(p_user_id, p_amount, p_description)`: Atomically refunds credits for a failed AI request. Adds credits back, inserts a credit_transaction with type 'credit_refund', records balance_before and balance_after, and returns the new balance.

3. Security Changes
- `profiles` table: REVOKED UPDATE privilege on `free_credits`, `paid_credits`, and `total_credits_used` columns from the `authenticated` role. Users can still UPDATE `full_name`, `plan`, `storage_used`, `storage_limit`, `images_used`, `images_limit`, `image_credits`, `updated_at` through the existing RLS policy. Credit columns can only be modified through the RPC functions which run with SECURITY DEFINER privileges.
- All three RPC functions have EXECUTE revoked from `anon` and granted to `authenticated` only.
- All three RPC functions use `SET search_path = public` to prevent search_path injection.

4. Important notes
- The RPC functions use `FOR UPDATE` row locking inside PL/pgSQL blocks to prevent race conditions. Two concurrent deduct_credits calls for the same user will serialize — the first locks the row, deducts, and commits; the second waits, reads the new balance, and proceeds.
- The `add_credits` function validates that p_amount > 0 and rejects negative or zero amounts.
- The `deduct_credits` function validates that p_amount > 0 and rejects if the user has insufficient credits (returns -1).
- The `refund_credits` function validates that p_amount > 0.
- All functions record balance_before and balance_after in the transaction.
- Existing transaction history is preserved. Old rows are backfilled with transaction_type='credit_usage' where mode is 'auto' or 'manual', 'credit_purchase' where mode is 'topup', and 'admin_adjustment' where mode is 'admin_adjust'. balance_before is set to balance_after minus credits_charged where balance_after is known.
- The credit_purchases table is now used by add_credits when source='purchase'.
*/

-- ─── Fix free_credits default to 100 ───
ALTER TABLE public.profiles ALTER COLUMN free_credits SET DEFAULT 100;

-- ─── Expand credit_transactions table ───
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS transaction_type text;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS balance_before integer;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS api_cost numeric;

-- Add check constraint for transaction_type
ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_transaction_type_check;
ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_transaction_type_check
  CHECK (transaction_type IS NULL OR transaction_type IN ('free_credit', 'credit_purchase', 'credit_usage', 'credit_refund', 'admin_adjustment'));

-- Backfill existing rows
UPDATE public.credit_transactions SET transaction_type = 'credit_usage' WHERE transaction_type IS NULL AND mode IN ('auto', 'manual');
UPDATE public.credit_transactions SET transaction_type = 'credit_purchase' WHERE transaction_type IS NULL AND mode = 'topup';
UPDATE public.credit_transactions SET transaction_type = 'admin_adjustment' WHERE transaction_type IS NULL AND mode = 'admin_adjust';
UPDATE public.credit_transactions SET balance_before = (balance_after - credits_charged) WHERE balance_before IS NULL AND balance_after IS NOT NULL;
UPDATE public.credit_transactions SET source = 'system' WHERE source IS NULL;
UPDATE public.credit_transactions SET description = mode WHERE description IS NULL;
UPDATE public.credit_transactions SET api_cost = actual_api_cost_usd WHERE api_cost IS NULL AND actual_api_cost_usd IS NOT NULL;

-- ─── Create add_credits RPC function ───
CREATE OR REPLACE FUNCTION public.add_credits(
  p_user_id uuid,
  p_amount integer,
  p_source text DEFAULT 'purchase',
  p_description text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_before integer;
  v_balance_after integer;
  v_transaction_type text;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid credit amount: must be positive';
  END IF;

  -- Lock the row and read current balance
  SELECT free_credits + paid_credits INTO v_balance_before
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  v_balance_after := v_balance_before + p_amount;
  v_transaction_type := CASE WHEN p_source = 'signup' THEN 'free_credit' ELSE 'credit_purchase' END;

  -- Add to paid_credits (purchased credits go to paid balance)
  UPDATE public.profiles
  SET paid_credits = paid_credits + p_amount,
      updated_at = now()
  WHERE id = p_user_id;

  -- Record transaction
  INSERT INTO public.credit_transactions (
    user_id, transaction_type, amount, balance_before, balance_after,
    source, description, mode, credits_charged, status, created_at
  ) VALUES (
    p_user_id, v_transaction_type, p_amount, v_balance_before, v_balance_after,
    p_source, COALESCE(p_description, 'Credit purchase'), 'topup', p_amount, 'success', now()
  );

  -- Record in credit_purchases if this is a purchase
  IF p_source = 'purchase' THEN
    INSERT INTO public.credit_purchases (user_id, kind, amount, price_bdt, status)
    VALUES (p_user_id, 'chat', p_amount, p_amount, 'completed');
  END IF;

  RETURN v_balance_after;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_credits FROM anon;
GRANT EXECUTE ON FUNCTION public.add_credits TO authenticated;

-- ─── Create deduct_credits RPC function ───
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id uuid,
  p_amount integer,
  p_provider text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_mode text DEFAULT 'auto',
  p_input_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL,
  p_total_tokens integer DEFAULT NULL,
  p_api_cost_usd numeric DEFAULT NULL,
  p_usd_to_bdt_rate numeric DEFAULT NULL,
  p_bdt_cost numeric DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_before integer;
  v_balance_after integer;
  v_free_credits integer;
  v_paid_credits integer;
  v_to_deduct integer;
  v_remaining_free integer;
  v_remaining_paid integer;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid credit amount: must be positive';
  END IF;

  -- Lock the row and read current balances
  SELECT free_credits, paid_credits INTO v_free_credits, v_paid_credits
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  v_balance_before := v_free_credits + v_paid_credits;

  -- Check for sufficient credits
  IF v_balance_before < p_amount THEN
    RETURN -1;
  END IF;

  -- Deduct from free credits first, then paid
  v_to_deduct := p_amount;
  v_remaining_free := v_free_credits;
  v_remaining_paid := v_paid_credits;

  IF v_remaining_free >= v_to_deduct THEN
    v_remaining_free := v_remaining_free - v_to_deduct;
    v_to_deduct := 0;
  ELSE
    v_to_deduct := v_to_deduct - v_remaining_free;
    v_remaining_free := 0;
    v_remaining_paid := GREATEST(0, v_remaining_paid - v_to_deduct);
  END IF;

  v_balance_after := v_remaining_free + v_remaining_paid;

  -- Update profile
  UPDATE public.profiles
  SET free_credits = v_remaining_free,
      paid_credits = v_remaining_paid,
      total_credits_used = total_credits_used + p_amount,
      updated_at = now()
  WHERE id = p_user_id;

  -- Record transaction
  INSERT INTO public.credit_transactions (
    user_id, transaction_type, amount, balance_before, balance_after,
    source, description, provider, model, mode,
    input_tokens, output_tokens, total_tokens,
    estimated_api_cost_usd, actual_api_cost_usd, usd_to_bdt_rate, bdt_cost,
    credits_charged, status, created_at
  ) VALUES (
    p_user_id, 'credit_usage', p_amount, v_balance_before, v_balance_after,
    'ai_request', 'AI request: ' || COALESCE(p_provider, 'unknown') || ' / ' || COALESCE(p_model, 'unknown'),
    p_provider, p_model, p_mode,
    p_input_tokens, p_output_tokens, p_total_tokens,
    p_api_cost_usd, p_api_cost_usd, p_usd_to_bdt_rate, p_bdt_cost,
    p_amount, 'success', now()
  );

  RETURN v_balance_after;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deduct_credits FROM anon;
GRANT EXECUTE ON FUNCTION public.deduct_credits TO authenticated;

-- ─── Create refund_credits RPC function ───
CREATE OR REPLACE FUNCTION public.refund_credits(
  p_user_id uuid,
  p_amount integer,
  p_description text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_before integer;
  v_balance_after integer;
  v_free_credits integer;
  v_paid_credits integer;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid refund amount: must be positive';
  END IF;

  -- Lock the row and read current balances
  SELECT free_credits, paid_credits INTO v_free_credits, v_paid_credits
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  v_balance_before := v_free_credits + v_paid_credits;
  v_balance_after := v_balance_before + p_amount;

  -- Refund goes to free credits first (since deductions take from free first)
  UPDATE public.profiles
  SET free_credits = free_credits + p_amount,
      total_credits_used = GREATEST(0, total_credits_used - p_amount),
      updated_at = now()
  WHERE id = p_user_id;

  -- Record transaction
  INSERT INTO public.credit_transactions (
    user_id, transaction_type, amount, balance_before, balance_after,
    source, description, mode, credits_charged, status, created_at
  ) VALUES (
    p_user_id, 'credit_refund', p_amount, v_balance_before, v_balance_after,
    'system', COALESCE(p_description, 'Credit refund for failed request'),
    'admin_adjust', p_amount, 'success', now()
  );

  RETURN v_balance_after;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_credits FROM anon;
GRANT EXECUTE ON FUNCTION public.refund_credits TO authenticated;

-- ─── Lock down profiles credit columns ───
-- Revoke table-wide UPDATE from authenticated, then grant only non-financial columns
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  full_name, plan, storage_used, storage_limit, images_used, images_limit,
  image_credits, updated_at
) ON public.profiles TO authenticated;

-- Ensure the existing RLS UPDATE policy still works for non-credit columns
-- (The policy allows auth.uid() = id, column privileges restrict WHICH columns)
