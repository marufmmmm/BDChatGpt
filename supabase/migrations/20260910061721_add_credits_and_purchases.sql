/*
# Add image credits and credit purchases

1. Modified Tables
- `profiles`: Added `image_credits` (integer, default 0) for purchased image generation credits separate from the monthly plan quota.

2. New Tables
- `credit_purchases`: Records every credit pack purchase (image or chat credits) with amount, price in BDT, and status.

3. Security
- RLS enabled on `credit_purchases` with owner-scoped CRUD policies.
- `image_credits` column is writable by the owner only (covered by existing profiles UPDATE policy).

4. Important notes
- Image credit packs are one-time purchases that don't expire with the monthly cycle.
- Chat credit packs add to the user's `paid_credits` balance.
- All purchases are tracked for audit and potential billing reconciliation.
*/

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS image_credits integer NOT NULL DEFAULT 0 CHECK (image_credits >= 0);

CREATE TABLE IF NOT EXISTS public.credit_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'chat')),
  amount integer NOT NULL CHECK (amount > 0),
  price_bdt integer NOT NULL CHECK (price_bdt >= 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own purchases" ON public.credit_purchases;
CREATE POLICY "Users can view own purchases" ON public.credit_purchases FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own purchases" ON public.credit_purchases;
CREATE POLICY "Users can insert own purchases" ON public.credit_purchases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own purchases" ON public.credit_purchases;
CREATE POLICY "Users can update own purchases" ON public.credit_purchases FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own purchases" ON public.credit_purchases;
CREATE POLICY "Users can delete own purchases" ON public.credit_purchases FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS credit_purchases_user_idx ON public.credit_purchases(user_id, created_at DESC);
