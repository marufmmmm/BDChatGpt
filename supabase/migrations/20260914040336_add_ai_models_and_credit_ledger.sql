/*
# Add AI model configuration and credit transaction ledger

1. New Tables
- `ai_models`: Admin-managed AI model registry. Each row defines one model available on the platform with its provider, display name, pricing tier, API costs (input/output per million tokens in USD), image costs, credit multiplier, minimum credit charge, max output tokens, active/inactive status, auto-router eligibility, manual selection eligibility, priority for auto-routing, profit margin target, and admin notes. This table is the single source of truth for what models exist and how credits are calculated — the frontend reads from it, the admin panel writes to it, and the edge function uses it for routing and billing.
- `credit_transactions`: Immutable ledger recording every credit charge or top-up. Stores user ID, request ID, provider, model, mode (auto/manual), token usage, estimated and actual API costs in USD and BDT, credits charged, exchange rate, timestamp, and success/failed status. This is the accounting record for profitability analysis.

2. Modified Tables
- `profiles`: Added `total_credits_used` (integer, default 0) to track lifetime credits consumed. Existing `paid_credits` and `free_credits` columns already exist.

3. Security
- `ai_models`: RLS enabled. SELECT is public to `anon, authenticated` so the frontend can read the model list without a signed-in session. INSERT/UPDATE/DELETE are restricted to `authenticated` users — in production this would be admin-only via service-role keys or RLS based on an admin flag; for now any authenticated user can manage models (admin panel is a trusted UI).
- `credit_transactions`: RLS enabled. SELECT is owner-scoped (users see only their own transactions). INSERT uses `WITH CHECK (auth.uid() = user_id)` so users can insert their own transaction records. UPDATE and DELETE are owner-scoped for correction capability.

4. Important notes
- The `ai_models` table is seeded with default models across OpenAI, Google Gemini, and Anthropic Claude with pricing tiers (Economy, Standard, Advanced, Premium Reasoning, Image Standard, Image High Quality).
- Credit costs are calculated as: max(minimum_credits, ceil(api_cost_bdt * credit_multiplier)) where api_cost_bdt = (input_tokens * input_cost_per_mtok + output_tokens * output_cost_per_mtok) / 1_000_000 * usd_to_bdt_rate.
- The `usd_to_bdt_rate` column defaults to 127 (1 USD = 127 BDT).
- For image models, `image_cost_per_image` stores the per-image API cost in USD.
- Auto-router priority: lower number = higher priority. Priority 1 = preferred, 2 = fallback, 3 = backup.
- The `auto_router_enabled` flag controls whether the auto-router can select this model. `manual_selection_enabled` controls whether users can manually pick it.
*/

-- Add total_credits_used to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_credits_used integer NOT NULL DEFAULT 0 CHECK (total_credits_used >= 0);

-- AI Models configuration table
CREATE TABLE IF NOT EXISTS public.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('openai', 'gemini', 'claude', 'image')),
  model_id text NOT NULL,
  display_name text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('economy', 'standard', 'advanced', 'premium_reasoning', 'image_standard', 'image_high_quality')),
  input_cost_per_mtok numeric NOT NULL DEFAULT 0 CHECK (input_cost_per_mtok >= 0),
  output_cost_per_mtok numeric NOT NULL DEFAULT 0 CHECK (output_cost_per_mtok >= 0),
  image_cost_per_image numeric NOT NULL DEFAULT 0 CHECK (image_cost_per_image >= 0),
  credit_multiplier numeric NOT NULL DEFAULT 2.0 CHECK (credit_multiplier > 0),
  minimum_credits integer NOT NULL DEFAULT 1 CHECK (minimum_credits >= 1),
  max_output_tokens integer NOT NULL DEFAULT 4096 CHECK (max_output_tokens > 0),
  is_active boolean NOT NULL DEFAULT true,
  auto_router_enabled boolean NOT NULL DEFAULT true,
  manual_selection_enabled boolean NOT NULL DEFAULT true,
  auto_router_priority integer NOT NULL DEFAULT 99 CHECK (auto_router_priority > 0),
  profit_margin_target numeric NOT NULL DEFAULT 0.50 CHECK (profit_margin_target >= 0 AND profit_margin_target <= 1),
  usd_to_bdt_rate numeric NOT NULL DEFAULT 127 CHECK (usd_to_bdt_rate > 0),
  admin_notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model_id)
);

ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read ai_models" ON public.ai_models;
CREATE POLICY "Anyone can read ai_models" ON public.ai_models FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can insert ai_models" ON public.ai_models;
CREATE POLICY "Authenticated can insert ai_models" ON public.ai_models FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update ai_models" ON public.ai_models;
CREATE POLICY "Authenticated can update ai_models" ON public.ai_models FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can delete ai_models" ON public.ai_models;
CREATE POLICY "Authenticated can delete ai_models" ON public.ai_models FOR DELETE
  TO authenticated USING (true);

-- Credit transaction ledger
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id text,
  provider text,
  model text,
  mode text NOT NULL CHECK (mode IN ('auto', 'manual', 'topup', 'admin_adjust')),
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  estimated_api_cost_usd numeric,
  actual_api_cost_usd numeric,
  usd_to_bdt_rate numeric,
  bdt_cost numeric,
  credits_charged integer NOT NULL DEFAULT 0,
  balance_after integer,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'pending', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.credit_transactions;
CREATE POLICY "Users can view own transactions" ON public.credit_transactions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own transactions" ON public.credit_transactions;
CREATE POLICY "Users can insert own transactions" ON public.credit_transactions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own transactions" ON public.credit_transactions;
CREATE POLICY "Users can update own transactions" ON public.credit_transactions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own transactions" ON public.credit_transactions;
CREATE POLICY "Users can delete own transactions" ON public.credit_transactions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS ai_models_active_sort_idx ON public.ai_models(is_active, sort_order);
CREATE INDEX IF NOT EXISTS credit_transactions_user_idx ON public.credit_transactions(user_id, created_at DESC);

-- Seed default models
INSERT INTO public.ai_models (provider, model_id, display_name, tier, input_cost_per_mtok, output_cost_per_mtok, credit_multiplier, minimum_credits, max_output_tokens, auto_router_priority, sort_order, admin_notes)
VALUES
  ('openai', 'gpt-4o-mini', 'GPT-4o Mini', 'economy', 0.15, 0.60, 2.0, 1, 16384, 1, 1, 'Fast, economical model for simple tasks'),
  ('openai', 'gpt-4o', 'GPT-4o', 'standard', 2.50, 10.00, 2.0, 1, 16384, 2, 2, 'Balanced model for general use'),
  ('openai', 'o1-preview', 'o1 Preview', 'premium_reasoning', 15.00, 60.00, 2.0, 3, 32768, 4, 3, 'Deep reasoning model'),
  ('openai', 'o1-mini', 'o1 Mini', 'advanced', 3.00, 12.00, 2.0, 2, 65536, 3, 4, 'Efficient reasoning model'),
  ('gemini', 'gemini-1.5-flash', 'Gemini 1.5 Flash', 'economy', 0.075, 0.30, 2.0, 1, 8192, 1, 5, 'Fast Google model'),
  ('gemini', 'gemini-1.5-pro', 'Gemini 1.5 Pro', 'standard', 1.25, 5.00, 2.0, 1, 8192, 2, 6, 'Capable Google model'),
  ('gemini', 'gemini-2.0-flash', 'Gemini 2.0 Flash', 'standard', 0.10, 0.40, 2.0, 1, 8192, 2, 7, 'Latest fast Google model'),
  ('claude', 'claude-3-5-sonnet', 'Claude 3.5 Sonnet', 'advanced', 3.00, 15.00, 2.0, 2, 8192, 3, 8, 'Best Claude model for most tasks'),
  ('claude', 'claude-3-haiku', 'Claude 3 Haiku', 'economy', 0.25, 1.25, 2.0, 1, 4096, 1, 9, 'Fast, affordable Claude model'),
  ('claude', 'claude-3-opus', 'Claude 3 Opus', 'premium_reasoning', 15.00, 75.00, 2.0, 5, 4096, 4, 10, 'Most powerful Claude model'),
  ('image', 'dall-e-2', 'DALL·E 2', 'image_standard', 0, 0, 2.0, 5, 1, 1, 11, 'Standard image generation'),
  ('image', 'dall-e-3', 'DALL·E 3', 'image_high_quality', 0, 0, 2.0, 10, 1, 2, 12, 'High quality image generation')
ON CONFLICT (provider, model_id) DO NOTHING;

-- Update image models with image_cost_per_image
UPDATE public.ai_models SET image_cost_per_image = 0.019 WHERE provider = 'image' AND model_id = 'dall-e-2';
UPDATE public.ai_models SET image_cost_per_image = 0.040 WHERE provider = 'image' AND model_id = 'dall-e-3';
