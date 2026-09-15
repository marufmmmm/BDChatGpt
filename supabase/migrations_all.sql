/*
# Create BDChat core persistence

1. New Tables
- `profiles`: one row per signed-in user with display name, plan, storage quota, and credits.
- `chat_threads`: chat history owned by a user.
- `chat_messages`: messages belonging to a user's chat thread.
- `stored_assets`: uploaded files and generated images with a hard 30-day expiry timestamp.

2. Security
- Row level security is enabled on every table.
- All access is limited to the authenticated owner through `auth.uid()`.
- Four separate CRUD policies are created for each table.

3. Important notes
- Profile rows default to the current authenticated user.
- Asset expiry is stored as a timestamp so daily cleanup can remove expired records later.
- Chat text remains independent from asset retention.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT 'BDChat User',
  plan text NOT NULL DEFAULT 'Free' CHECK (plan IN ('Free', 'Normal', 'Medium', 'Pro')),
  storage_used bigint NOT NULL DEFAULT 0 CHECK (storage_used >= 0),
  storage_limit bigint NOT NULL DEFAULT 104857600 CHECK (storage_limit > 0),
  paid_credits integer NOT NULL DEFAULT 0 CHECK (paid_credits >= 0),
  free_credits integer NOT NULL DEFAULT 5 CHECK (free_credits >= 0),
  images_used integer NOT NULL DEFAULT 0 CHECK (images_used >= 0),
  images_limit integer NOT NULL DEFAULT 2 CHECK (images_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  model text NOT NULL DEFAULT 'GPT-4 Mini',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stored_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('file', 'image')),
  name text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  prompt text,
  url text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  deleted_at timestamptz
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stored_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY "Users can delete own profile" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can view own threads" ON public.chat_threads;
CREATE POLICY "Users can view own threads" ON public.chat_threads FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own threads" ON public.chat_threads;
CREATE POLICY "Users can insert own threads" ON public.chat_threads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own threads" ON public.chat_threads;
CREATE POLICY "Users can update own threads" ON public.chat_threads FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own threads" ON public.chat_threads;
CREATE POLICY "Users can delete own threads" ON public.chat_threads FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own messages" ON public.chat_messages;
CREATE POLICY "Users can view own messages" ON public.chat_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own messages" ON public.chat_messages;
CREATE POLICY "Users can insert own messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.chat_threads WHERE chat_threads.id = thread_id AND chat_threads.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can update own messages" ON public.chat_messages;
CREATE POLICY "Users can update own messages" ON public.chat_messages FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own messages" ON public.chat_messages;
CREATE POLICY "Users can delete own messages" ON public.chat_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own assets" ON public.stored_assets;
CREATE POLICY "Users can view own assets" ON public.stored_assets FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own assets" ON public.stored_assets;
CREATE POLICY "Users can insert own assets" ON public.stored_assets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own assets" ON public.stored_assets;
CREATE POLICY "Users can update own assets" ON public.stored_assets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own assets" ON public.stored_assets;
CREATE POLICY "Users can delete own assets" ON public.stored_assets FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS chat_threads_user_updated_idx ON public.chat_threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx ON public.chat_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS stored_assets_user_expiry_idx ON public.stored_assets(user_id, expires_at);
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
/*
# Add new AI providers: xAI Grok, DeepSeek, Kimi, OpenRouter

1. Modified Tables
- `ai_models`: The `provider` column CHECK constraint is updated to allow 'grok', 'deepseek', 'kimi', 'openrouter' in addition to the existing 'openai', 'gemini', 'claude', 'image'. This is done by dropping the old constraint and adding a new one.

2. New Seed Data
- DeepSeek models: deepseek-chat (economy), deepseek-reasoner (advanced) — lowest cost models for smart routing priority
- xAI Grok models: grok-2 (standard), grok-2-mini (economy)
- Kimi models: moonshot-v1-8k (economy), moonshot-v1-32k (standard)
- OpenRouter model: openrouter/auto (economy) — routes to cheapest available provider

3. Updated Existing Models
- GPT-4o Mini renamed display to "GPT Mini" for simpler user-facing naming
- Gemini 1.5 Flash renamed display to "Gemini Flash" for simpler naming
- Claude 3 Haiku renamed display to "Claude Lite" for simpler naming
- Auto-router priorities updated to match cost-optimization strategy:
  Priority 1 (preferred): DeepSeek, Gemini Flash, Kimi (economy models)
  Priority 2 (fallback): GPT Mini, Grok (standard models)
  Priority 3 (backup): GPT-4o, Claude 3.5 Sonnet (advanced models)
  Priority 4 (premium): o1 Preview, Claude 3 Opus (premium reasoning)

4. Important notes
- All new models have credit_multiplier 2.0 (50% profit margin target)
- DeepSeek has the lowest API costs ($0.14/M input, $0.28/M output) so it gets priority 1
- The admin can change all settings from the admin panel without code changes
- New providers can be added by inserting rows into ai_models — no schema changes needed
*/

-- Drop old provider constraint and add expanded one
ALTER TABLE public.ai_models DROP CONSTRAINT IF EXISTS ai_models_provider_check;
ALTER TABLE public.ai_models ADD CONSTRAINT ai_models_provider_check
  CHECK (provider IN ('openai', 'gemini', 'claude', 'grok', 'deepseek', 'kimi', 'openrouter', 'image'));

-- Update display names for simpler user-facing labels
UPDATE public.ai_models SET display_name = 'GPT Mini', auto_router_priority = 2 WHERE model_id = 'gpt-4o-mini';
UPDATE public.ai_models SET display_name = 'GPT Premium', auto_router_priority = 3 WHERE model_id = 'gpt-4o';
UPDATE public.ai_models SET display_name = 'Gemini Flash', auto_router_priority = 1 WHERE model_id = 'gemini-1.5-flash';
UPDATE public.ai_models SET display_name = 'Gemini Pro', auto_router_priority = 2 WHERE model_id = 'gemini-1.5-pro';
UPDATE public.ai_models SET display_name = 'Claude Lite', auto_router_priority = 1 WHERE model_id = 'claude-3-haiku';
UPDATE public.ai_models SET display_name = 'Claude Premium', auto_router_priority = 3 WHERE model_id = 'claude-3-5-sonnet';
UPDATE public.ai_models SET display_name = 'Claude Opus', auto_router_priority = 4 WHERE model_id = 'claude-3-opus';

-- Seed DeepSeek models (lowest cost — highest routing priority)
INSERT INTO public.ai_models (provider, model_id, display_name, tier, input_cost_per_mtok, output_cost_per_mtok, credit_multiplier, minimum_credits, max_output_tokens, auto_router_priority, sort_order, admin_notes)
VALUES
  ('deepseek', 'deepseek-chat', 'DeepSeek', 'economy', 0.14, 0.28, 2.0, 1, 8192, 1, 13, 'Lowest cost model — preferred for simple tasks'),
  ('deepseek', 'deepseek-reasoner', 'DeepSeek Reasoner', 'advanced', 0.55, 2.19, 2.0, 2, 8192, 3, 14, 'Reasoning model for advanced tasks')
ON CONFLICT (provider, model_id) DO NOTHING;

-- Seed xAI Grok models
INSERT INTO public.ai_models (provider, model_id, display_name, tier, input_cost_per_mtok, output_cost_per_mtok, credit_multiplier, minimum_credits, max_output_tokens, auto_router_priority, sort_order, admin_notes)
VALUES
  ('grok', 'grok-2', 'Grok 2', 'standard', 2.00, 10.00, 2.0, 1, 4096, 2, 15, 'xAI Grok standard model'),
  ('grok', 'grok-2-mini', 'Grok 2 Mini', 'economy', 0.20, 0.60, 2.0, 1, 4096, 2, 16, 'xAI Grok economy model')
ON CONFLICT (provider, model_id) DO NOTHING;

-- Seed Kimi (Moonshot) models
INSERT INTO public.ai_models (provider, model_id, display_name, tier, input_cost_per_mtok, output_cost_per_mtok, credit_multiplier, minimum_credits, max_output_tokens, auto_router_priority, sort_order, admin_notes)
VALUES
  ('kimi', 'moonshot-v1-8k', 'Kimi 8K', 'economy', 0.56, 0.56, 2.0, 1, 8192, 1, 17, 'Kimi economy model with 8K context'),
  ('kimi', 'moonshot-v1-32k', 'Kimi 32K', 'standard', 1.12, 1.12, 2.0, 1, 32768, 2, 18, 'Kimi standard model with 32K context')
ON CONFLICT (provider, model_id) DO NOTHING;

-- Seed OpenRouter (auto-routes to cheapest provider)
INSERT INTO public.ai_models (provider, model_id, display_name, tier, input_cost_per_mtok, output_cost_per_mtok, credit_multiplier, minimum_credits, max_output_tokens, auto_router_enabled, auto_router_priority, sort_order, admin_notes)
VALUES
  ('openrouter', 'auto', 'OpenRouter Auto', 'economy', 0.50, 0.50, 2.0, 1, 4096, false, 99, 19, 'OpenRouter automatically routes to cheapest provider — disabled for auto-router to avoid double routing')
ON CONFLICT (provider, model_id) DO NOTHING;
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
/*
# Task 2: AI Model Credit Control Layer — Schema Extensions

## Purpose
Extends the existing ai_models table with capability flags, fallback priority,
and context limits. Adds an admin role to profiles. Creates a system_config
table for global profit-protection settings. Updates credit multipliers on
existing model records. Restructures image model tiers to support Fast /
Standard / Premium / Ultra HD without exposing provider names to users.

## Changes
1. profiles: add role column (text, default 'user', CHECK for 'user'/'admin')
2. ai_models: add supports_*, max_context, fallback_priority columns
3. Drop unique constraint on (provider, model_id) to allow multiple image tiers
   using the same underlying API model (e.g. dall-e-3 at different quality levels)
4. Drop old tier CHECK constraint, update image model tiers, add new CHECK
5. Backfill supports_* from existing tiers
6. Update credit_multiplier on specific models
7. Add Premium Image and Ultra HD Image records
8. Create system_config table with profit protection settings

## Important Notes
1. No existing columns removed or renamed
2. No existing data lost
3. Task 1 credit system not modified
*/

-- ─── 1. profiles: add role column ───

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

-- ─── 2. ai_models: add new columns ───

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS supports_chat boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_image boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_reasoning boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_web boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_coding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_context integer NOT NULL DEFAULT 4096,
  ADD COLUMN IF NOT EXISTS fallback_priority integer NOT NULL DEFAULT 99;

-- ─── 3. Drop unique constraint on (provider, model_id) ───
-- Multiple image tiers can share the same underlying API model (e.g. dall-e-3)
-- but with different quality parameters and credit costs.

ALTER TABLE public.ai_models DROP CONSTRAINT IF EXISTS ai_models_provider_model_id_key;

-- ─── 4. Drop old tier CHECK, update image tiers, add new CHECK ───

ALTER TABLE public.ai_models DROP CONSTRAINT IF EXISTS ai_models_tier_check;

-- DALL-E 2 → Fast Image
UPDATE public.ai_models
  SET display_name = 'Fast Image', minimum_credits = 10, tier = 'image_fast', updated_at = now()
  WHERE model_id = 'dall-e-2';

-- DALL-E 3 → Standard Image
UPDATE public.ai_models
  SET display_name = 'Standard Image', minimum_credits = 15, tier = 'image_standard', updated_at = now()
  WHERE model_id = 'dall-e-3' AND display_name = 'DALL·E 3';

ALTER TABLE public.ai_models
  ADD CONSTRAINT ai_models_tier_check CHECK (
    tier = ANY (ARRAY[
      'economy'::text, 'standard'::text, 'advanced'::text, 'premium_reasoning'::text,
      'image_fast'::text, 'image_standard'::text, 'image_premium'::text, 'image_ultra_hd'::text
    ])
  );

-- ─── 5. Backfill supports_* from existing tiers ───

UPDATE public.ai_models SET supports_chat = true WHERE provider <> 'image';
UPDATE public.ai_models SET supports_chat = false, supports_image = true WHERE provider = 'image';
UPDATE public.ai_models SET supports_reasoning = true WHERE tier = 'premium_reasoning';
UPDATE public.ai_models SET supports_coding = true WHERE tier = 'advanced';

-- ─── 6. Update credit_multiplier on specific models ───

UPDATE public.ai_models SET credit_multiplier = 0.5, updated_at = now() WHERE model_id = 'deepseek-chat';
UPDATE public.ai_models SET credit_multiplier = 0.5, updated_at = now() WHERE model_id = 'gemini-1.5-flash';
UPDATE public.ai_models SET credit_multiplier = 0.5, updated_at = now() WHERE model_id = 'moonshot-v1-8k';
UPDATE public.ai_models SET credit_multiplier = 1.0, updated_at = now() WHERE model_id = 'gpt-4o-mini';
UPDATE public.ai_models SET credit_multiplier = 2.0, updated_at = now() WHERE model_id = 'grok-2';
UPDATE public.ai_models SET credit_multiplier = 3.0, updated_at = now() WHERE model_id = 'gpt-4o';
UPDATE public.ai_models SET credit_multiplier = 3.0, updated_at = now() WHERE model_id = 'claude-3-5-sonnet';

-- ─── 7. Add Premium Image and Ultra HD Image tiers ───

INSERT INTO public.ai_models (
  provider, model_id, display_name, tier,
  input_cost_per_mtok, output_cost_per_mtok, image_cost_per_image,
  credit_multiplier, minimum_credits, max_output_tokens,
  is_active, auto_router_enabled, manual_selection_enabled,
  auto_router_priority, profit_margin_target, usd_to_bdt_rate,
  admin_notes, sort_order,
  supports_chat, supports_image, supports_reasoning, supports_web, supports_coding,
  max_context, fallback_priority
)
SELECT 'image', 'dall-e-3', 'Premium Image', 'image_premium',
  0, 0, 0.04, 2.0, 25, 1, true, true, true, 3, 0.50, 127,
  'Premium quality image generation', 13,
  false, true, false, false, false, 0, 3
WHERE NOT EXISTS (SELECT 1 FROM public.ai_models WHERE display_name = 'Premium Image');

INSERT INTO public.ai_models (
  provider, model_id, display_name, tier,
  input_cost_per_mtok, output_cost_per_mtok, image_cost_per_image,
  credit_multiplier, minimum_credits, max_output_tokens,
  is_active, auto_router_enabled, manual_selection_enabled,
  auto_router_priority, profit_margin_target, usd_to_bdt_rate,
  admin_notes, sort_order,
  supports_chat, supports_image, supports_reasoning, supports_web, supports_coding,
  max_context, fallback_priority
)
SELECT 'image', 'dall-e-3', 'Ultra HD Image', 'image_ultra_hd',
  0, 0, 0.04, 2.0, 35, 1, true, true, true, 4, 0.50, 127,
  'Ultra HD quality image generation', 14,
  false, true, false, false, false, 0, 4
WHERE NOT EXISTS (SELECT 1 FROM public.ai_models WHERE display_name = 'Ultra HD Image');

-- ─── 8. system_config table ───

CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.system_config (key, value, description) VALUES
  ('target_profit_margin', 0.50, 'Minimum profit margin target (0.50 = 50%)'),
  ('maximum_allowed_api_cost', 10.00, 'Maximum allowed API cost per single request in USD'),
  ('minimum_credit_charge', 1, 'Minimum credit charge for any AI request')
ON CONFLICT (key) DO NOTHING;
/*
# Task 2: Security Lockdown — ai_models RLS + user_models View

## Purpose
Locks down the ai_models table so normal users cannot modify model pricing,
routing, or configuration. Creates a safe view (user_models) that exposes only
the information a normal user needs: display name, tier, minimum credits, manual
selection flag, and capability flags. Sensitive columns (provider, model_id,
API costs, credit_multiplier, profit_margin, admin_notes, routing priorities,
is_active) are hidden from normal users.

## Changes

### 1. ai_models — revoke all direct access from anon and authenticated
- Revoke SELECT, INSERT, UPDATE, DELETE from both roles
- Drop all existing wide-open policies

### 2. Create user_models view
- Exposes: id, display_name, tier, minimum_credits, manual_selection_enabled,
  supports_chat, supports_image, supports_reasoning, supports_web, supports_coding,
  max_context, sort_order
- Filtered to is_active = true only
- Does NOT expose: provider, model_id, input_cost_per_mtok, output_cost_per_mtok,
  image_cost_per_image, credit_multiplier, profit_margin_target, usd_to_bdt_rate,
  admin_notes, auto_router_enabled, auto_router_priority, fallback_priority, is_active
- Grant SELECT to anon, authenticated

### 3. system_config — add SELECT policy for authenticated
- No direct INSERT/UPDATE/DELETE for any role (writes go through admin RPC)

## Security
- Normal users can only read safe model info via the view
- All model modifications go through SECURITY DEFINER functions (next migration)
- The edge function uses the service role key which bypasses RLS entirely
*/

-- ─── 1. Revoke all direct access on ai_models ───

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.ai_models FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.ai_models FROM authenticated;

-- Drop all existing policies on ai_models
DROP POLICY IF EXISTS "Anyone can read ai_models" ON public.ai_models;
DROP POLICY IF EXISTS "Authenticated can delete ai_models" ON public.ai_models;
DROP POLICY IF EXISTS "Authenticated can insert ai_models" ON public.ai_models;
DROP POLICY IF EXISTS "Authenticated can update ai_models" ON public.ai_models;

-- ─── 2. Create user_models view ───

CREATE OR REPLACE VIEW public.user_models AS
SELECT
  id,
  display_name,
  tier,
  minimum_credits,
  manual_selection_enabled,
  supports_chat,
  supports_image,
  supports_reasoning,
  supports_web,
  supports_coding,
  max_context,
  sort_order
FROM public.ai_models
WHERE is_active = true;

GRANT SELECT ON public.user_models TO anon, authenticated;

-- ─── 3. system_config SELECT policy ───

DROP POLICY IF EXISTS "authenticated_read_system_config" ON public.system_config;
CREATE POLICY "authenticated_read_system_config"
  ON public.system_config FOR SELECT
  TO authenticated
  USING (true);
/*
# Task 2: RPC Functions — Credit Calculation + Admin Model Management

## Purpose
Creates server-side functions for:
1. Credit cost calculation (read-only, never deducts)
2. Admin-only model listing (all models including inactive)
3. Admin-only model save (insert/update)
4. Admin-only model deletion
5. Admin-only system config updates

## Security
- All functions are SECURITY DEFINER with SET search_path = public
- EXECUTE revoked from anon, granted to authenticated
- Admin functions check profiles.role = 'admin' for the calling user
- calculate_credit_cost reads pricing from the database, never trusts client values

## Functions

### calculate_credit_cost(p_model_id text, p_input_tokens int, p_output_tokens int, p_request_type text)
Returns: (credits int, api_cost_usd numeric, model_display_name text, pricing_rule text)
- Looks up model by model_id or id::text in ai_models
- For image requests: uses image_cost_per_image
- For chat requests: uses input_cost_per_mtok and output_cost_per_mtok
- Applies credit_multiplier, minimum_credits, and minimum_credit_charge from system_config
- Does NOT deduct credits

### get_all_models()
Returns: TABLE with all ai_models columns
- Admin-only: checks profiles.role = 'admin'

### save_ai_model(...)
Returns: uuid (the model id)
- Admin-only
- If p_id is null: INSERT, return new id
- If p_id exists: UPDATE, return same id

### delete_ai_model(p_id uuid)
Returns: void
- Admin-only

### update_system_config(p_key text, p_value numeric)
Returns: void
- Admin-only
- Upserts system_config row
*/

-- ─── 1. calculate_credit_cost ───

CREATE OR REPLACE FUNCTION public.calculate_credit_cost(
  p_model_id text,
  p_input_tokens integer DEFAULT 0,
  p_output_tokens integer DEFAULT 0,
  p_request_type text DEFAULT 'chat'
)
RETURNS TABLE(
  credits integer,
  api_cost_usd numeric,
  model_display_name text,
  pricing_rule text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model public.ai_models%ROWTYPE;
  v_api_cost_usd numeric;
  v_api_cost_bdt numeric;
  v_credits integer;
  v_min_charge integer;
  v_usd_to_bdt numeric;
BEGIN
  -- Look up the model by model_id or by uuid id
  SELECT * INTO v_model
  FROM public.ai_models
  WHERE model_id = p_model_id OR id::text = p_model_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Model not found: %', p_model_id;
  END IF;

  -- Get minimum_credit_charge from system_config
  SELECT COALESCE(value, 1) INTO v_min_charge
  FROM public.system_config
  WHERE key = 'minimum_credit_charge';

  v_usd_to_bdt := v_model.usd_to_bdt_rate;

  IF p_request_type = 'image' THEN
    -- Image: fixed cost per image
    v_api_cost_usd := v_model.image_cost_per_image;
    v_api_cost_bdt := v_api_cost_usd * v_usd_to_bdt;
    v_credits := GREATEST(
      v_model.minimum_credits,
      CEIL(v_api_cost_bdt * v_model.credit_multiplier),
      v_min_charge
    );
    RETURN QUERY SELECT v_credits, v_api_cost_usd, v_model.display_name, 'image_fixed'::text;
  ELSE
    -- Chat: token-based cost
    v_api_cost_usd := (
      p_input_tokens * v_model.input_cost_per_mtok +
      p_output_tokens * v_model.output_cost_per_mtok
    ) / 1000000.0;
    v_api_cost_bdt := v_api_cost_usd * v_usd_to_bdt;
    v_credits := GREATEST(
      v_model.minimum_credits,
      CEIL(v_api_cost_bdt * v_model.credit_multiplier),
      v_min_charge
    );
    RETURN QUERY SELECT v_credits, v_api_cost_usd, v_model.display_name, 'token_based'::text;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.calculate_credit_cost(text, integer, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_credit_cost(text, integer, integer, text) TO authenticated;

-- ─── 2. get_all_models (admin-only) ───

CREATE OR REPLACE FUNCTION public.get_all_models()
RETURNS TABLE(
  id uuid,
  provider text,
  model_id text,
  display_name text,
  tier text,
  input_cost_per_mtok numeric,
  output_cost_per_mtok numeric,
  image_cost_per_image numeric,
  credit_multiplier numeric,
  minimum_credits integer,
  max_output_tokens integer,
  is_active boolean,
  auto_router_enabled boolean,
  manual_selection_enabled boolean,
  auto_router_priority integer,
  profit_margin_target numeric,
  usd_to_bdt_rate numeric,
  admin_notes text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz,
  supports_chat boolean,
  supports_image boolean,
  supports_reasoning boolean,
  supports_web boolean,
  supports_coding boolean,
  max_context integer,
  fallback_priority integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  RETURN QUERY SELECT * FROM public.ai_models ORDER BY sort_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_all_models() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_all_models() TO authenticated;

-- ─── 3. save_ai_model (admin-only) ───

CREATE OR REPLACE FUNCTION public.save_ai_model(
  p_id uuid,
  p_provider text,
  p_model_id text,
  p_display_name text,
  p_tier text,
  p_input_cost_per_mtok numeric,
  p_output_cost_per_mtok numeric,
  p_image_cost_per_image numeric,
  p_credit_multiplier numeric,
  p_minimum_credits integer,
  p_max_output_tokens integer,
  p_is_active boolean,
  p_auto_router_enabled boolean,
  p_manual_selection_enabled boolean,
  p_auto_router_priority integer,
  p_fallback_priority integer,
  p_profit_margin_target numeric,
  p_usd_to_bdt_rate numeric,
  p_admin_notes text,
  p_sort_order integer,
  p_supports_chat boolean,
  p_supports_image boolean,
  p_supports_reasoning boolean,
  p_supports_web boolean,
  p_supports_coding boolean,
  p_max_context integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_new_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  IF p_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ai_models WHERE id = p_id) THEN
    UPDATE public.ai_models SET
      provider = p_provider,
      model_id = p_model_id,
      display_name = p_display_name,
      tier = p_tier,
      input_cost_per_mtok = p_input_cost_per_mtok,
      output_cost_per_mtok = p_output_cost_per_mtok,
      image_cost_per_image = p_image_cost_per_image,
      credit_multiplier = p_credit_multiplier,
      minimum_credits = p_minimum_credits,
      max_output_tokens = p_max_output_tokens,
      is_active = p_is_active,
      auto_router_enabled = p_auto_router_enabled,
      manual_selection_enabled = p_manual_selection_enabled,
      auto_router_priority = p_auto_router_priority,
      fallback_priority = p_fallback_priority,
      profit_margin_target = p_profit_margin_target,
      usd_to_bdt_rate = p_usd_to_bdt_rate,
      admin_notes = p_admin_notes,
      sort_order = p_sort_order,
      supports_chat = p_supports_chat,
      supports_image = p_supports_image,
      supports_reasoning = p_supports_reasoning,
      supports_web = p_supports_web,
      supports_coding = p_supports_coding,
      max_context = p_max_context,
      updated_at = now()
    WHERE id = p_id;
    RETURN p_id;
  ELSE
    INSERT INTO public.ai_models (
      provider, model_id, display_name, tier,
      input_cost_per_mtok, output_cost_per_mtok, image_cost_per_image,
      credit_multiplier, minimum_credits, max_output_tokens,
      is_active, auto_router_enabled, manual_selection_enabled,
      auto_router_priority, fallback_priority, profit_margin_target, usd_to_bdt_rate,
      admin_notes, sort_order,
      supports_chat, supports_image, supports_reasoning, supports_web, supports_coding,
      max_context
    ) VALUES (
      p_provider, p_model_id, p_display_name, p_tier,
      p_input_cost_per_mtok, p_output_cost_per_mtok, p_image_cost_per_image,
      p_credit_multiplier, p_minimum_credits, p_max_output_tokens,
      p_is_active, p_auto_router_enabled, p_manual_selection_enabled,
      p_auto_router_priority, p_fallback_priority, p_profit_margin_target, p_usd_to_bdt_rate,
      p_admin_notes, p_sort_order,
      p_supports_chat, p_supports_image, p_supports_reasoning, p_supports_web, p_supports_coding,
      p_max_context
    )
    RETURNING id INTO v_new_id;
    RETURN v_new_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_ai_model(uuid, text, text, text, text, numeric, numeric, numeric, numeric, integer, integer, boolean, boolean, boolean, integer, integer, numeric, numeric, text, integer, boolean, boolean, boolean, boolean, boolean, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_ai_model(uuid, text, text, text, text, numeric, numeric, numeric, numeric, integer, integer, boolean, boolean, boolean, integer, integer, numeric, numeric, text, integer, boolean, boolean, boolean, boolean, boolean, integer) TO authenticated;

-- ─── 4. delete_ai_model (admin-only) ───

CREATE OR REPLACE FUNCTION public.delete_ai_model(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  DELETE FROM public.ai_models WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_ai_model(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_ai_model(uuid) TO authenticated;

-- ─── 5. update_system_config (admin-only) ───

CREATE OR REPLACE FUNCTION public.update_system_config(
  p_key text,
  p_value numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  INSERT INTO public.system_config (key, value, updated_at, updated_by)
  VALUES (p_key, p_value, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now(),
        updated_by = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_system_config(text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_system_config(text, numeric) TO authenticated;
/*
# Fix: Admin Role Check NULL Safety

## Problem
The admin RPC functions (get_all_models, save_ai_model, delete_ai_model, update_system_config)
check `IF v_role <> 'admin'` but when v_role is NULL (no profile row), `NULL <> 'admin'`
evaluates to NULL, which is treated as FALSE in an IF statement — so the check is bypassed
and a user with no profile row can execute admin functions.

## Fix
Change all 4 admin functions to use `IF v_role IS DISTINCT FROM 'admin'` which correctly
handles NULL values (NULL IS DISTINCT FROM 'admin' = TRUE).

## Security Impact
This is a privilege escalation fix — without it, any authenticated user with no profile
row could create, edit, or delete AI models and change system config.
*/

-- ─── Fix get_all_models ───
CREATE OR REPLACE FUNCTION public.get_all_models()
RETURNS TABLE(
  id uuid,
  provider text,
  model_id text,
  display_name text,
  tier text,
  input_cost_per_mtok numeric,
  output_cost_per_mtok numeric,
  image_cost_per_image numeric,
  credit_multiplier numeric,
  minimum_credits integer,
  max_output_tokens integer,
  is_active boolean,
  auto_router_enabled boolean,
  manual_selection_enabled boolean,
  auto_router_priority integer,
  profit_margin_target numeric,
  usd_to_bdt_rate numeric,
  admin_notes text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz,
  supports_chat boolean,
  supports_image boolean,
  supports_reasoning boolean,
  supports_web boolean,
  supports_coding boolean,
  max_context integer,
  fallback_priority integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  RETURN QUERY SELECT * FROM public.ai_models ORDER BY sort_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_all_models() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_all_models() TO authenticated;

-- ─── Fix save_ai_model ───
CREATE OR REPLACE FUNCTION public.save_ai_model(
  p_id uuid,
  p_provider text,
  p_model_id text,
  p_display_name text,
  p_tier text,
  p_input_cost_per_mtok numeric,
  p_output_cost_per_mtok numeric,
  p_image_cost_per_image numeric,
  p_credit_multiplier numeric,
  p_minimum_credits integer,
  p_max_output_tokens integer,
  p_is_active boolean,
  p_auto_router_enabled boolean,
  p_manual_selection_enabled boolean,
  p_auto_router_priority integer,
  p_fallback_priority integer,
  p_profit_margin_target numeric,
  p_usd_to_bdt_rate numeric,
  p_admin_notes text,
  p_sort_order integer,
  p_supports_chat boolean,
  p_supports_image boolean,
  p_supports_reasoning boolean,
  p_supports_web boolean,
  p_supports_coding boolean,
  p_max_context integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_new_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  IF p_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ai_models WHERE id = p_id) THEN
    UPDATE public.ai_models SET
      provider = p_provider,
      model_id = p_model_id,
      display_name = p_display_name,
      tier = p_tier,
      input_cost_per_mtok = p_input_cost_per_mtok,
      output_cost_per_mtok = p_output_cost_per_mtok,
      image_cost_per_image = p_image_cost_per_image,
      credit_multiplier = p_credit_multiplier,
      minimum_credits = p_minimum_credits,
      max_output_tokens = p_max_output_tokens,
      is_active = p_is_active,
      auto_router_enabled = p_auto_router_enabled,
      manual_selection_enabled = p_manual_selection_enabled,
      auto_router_priority = p_auto_router_priority,
      fallback_priority = p_fallback_priority,
      profit_margin_target = p_profit_margin_target,
      usd_to_bdt_rate = p_usd_to_bdt_rate,
      admin_notes = p_admin_notes,
      sort_order = p_sort_order,
      supports_chat = p_supports_chat,
      supports_image = p_supports_image,
      supports_reasoning = p_supports_reasoning,
      supports_web = p_supports_web,
      supports_coding = p_supports_coding,
      max_context = p_max_context,
      updated_at = now()
    WHERE id = p_id;
    RETURN p_id;
  ELSE
    INSERT INTO public.ai_models (
      provider, model_id, display_name, tier,
      input_cost_per_mtok, output_cost_per_mtok, image_cost_per_image,
      credit_multiplier, minimum_credits, max_output_tokens,
      is_active, auto_router_enabled, manual_selection_enabled,
      auto_router_priority, fallback_priority, profit_margin_target, usd_to_bdt_rate,
      admin_notes, sort_order,
      supports_chat, supports_image, supports_reasoning, supports_web, supports_coding,
      max_context
    ) VALUES (
      p_provider, p_model_id, p_display_name, p_tier,
      p_input_cost_per_mtok, p_output_cost_per_mtok, p_image_cost_per_image,
      p_credit_multiplier, p_minimum_credits, p_max_output_tokens,
      p_is_active, p_auto_router_enabled, p_manual_selection_enabled,
      p_auto_router_priority, p_fallback_priority, p_profit_margin_target, p_usd_to_bdt_rate,
      p_admin_notes, p_sort_order,
      p_supports_chat, p_supports_image, p_supports_reasoning, p_supports_web, p_supports_coding,
      p_max_context
    )
    RETURNING id INTO v_new_id;
    RETURN v_new_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_ai_model(uuid, text, text, text, text, numeric, numeric, numeric, numeric, integer, integer, boolean, boolean, boolean, integer, integer, numeric, numeric, text, integer, boolean, boolean, boolean, boolean, boolean, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_ai_model(uuid, text, text, text, text, numeric, numeric, numeric, numeric, integer, integer, boolean, boolean, boolean, integer, integer, numeric, numeric, text, integer, boolean, boolean, boolean, boolean, boolean, integer) TO authenticated;

-- ─── Fix delete_ai_model ───
CREATE OR REPLACE FUNCTION public.delete_ai_model(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  DELETE FROM public.ai_models WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_ai_model(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_ai_model(uuid) TO authenticated;

-- ─── Fix update_system_config ───
CREATE OR REPLACE FUNCTION public.update_system_config(
  p_key text,
  p_value numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  INSERT INTO public.system_config (key, value, updated_at, updated_by)
  VALUES (p_key, p_value, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now(),
        updated_by = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_system_config(text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_system_config(text, numeric) TO authenticated;
/*
# Fix: get_all_models ambiguous column reference

## Problem
The get_all_models function uses `RETURN QUERY SELECT * FROM ai_models` which causes
an ambiguous column reference for "id" because the function's return type also has an "id"
column and Postgres can't resolve which one to use in the implicit column mapping.

## Fix
Use explicit column names in the SELECT to avoid ambiguity.
*/

CREATE OR REPLACE FUNCTION public.get_all_models()
RETURNS TABLE(
  id uuid,
  provider text,
  model_id text,
  display_name text,
  tier text,
  input_cost_per_mtok numeric,
  output_cost_per_mtok numeric,
  image_cost_per_image numeric,
  credit_multiplier numeric,
  minimum_credits integer,
  max_output_tokens integer,
  is_active boolean,
  auto_router_enabled boolean,
  manual_selection_enabled boolean,
  auto_router_priority integer,
  profit_margin_target numeric,
  usd_to_bdt_rate numeric,
  admin_notes text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz,
  supports_chat boolean,
  supports_image boolean,
  supports_reasoning boolean,
  supports_web boolean,
  supports_coding boolean,
  max_context integer,
  fallback_priority integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  RETURN QUERY SELECT
    m.id, m.provider, m.model_id, m.display_name, m.tier,
    m.input_cost_per_mtok, m.output_cost_per_mtok, m.image_cost_per_image,
    m.credit_multiplier, m.minimum_credits, m.max_output_tokens,
    m.is_active, m.auto_router_enabled, m.manual_selection_enabled,
    m.auto_router_priority, m.profit_margin_target, m.usd_to_bdt_rate,
    m.admin_notes, m.sort_order, m.created_at, m.updated_at,
    m.supports_chat, m.supports_image, m.supports_reasoning, m.supports_web,
    m.supports_coding, m.max_context, m.fallback_priority
  FROM public.ai_models m
  ORDER BY m.sort_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_all_models() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_all_models() TO authenticated;
/*
# Fix: Ambiguous id in get_all_models WHERE clause

The `SELECT role FROM profiles WHERE id = auth.uid()` inside the function
conflicts with the function's output column named "id". Aliasing the table
column resolves the ambiguity.
*/

CREATE OR REPLACE FUNCTION public.get_all_models()
RETURNS TABLE(
  id uuid,
  provider text,
  model_id text,
  display_name text,
  tier text,
  input_cost_per_mtok numeric,
  output_cost_per_mtok numeric,
  image_cost_per_image numeric,
  credit_multiplier numeric,
  minimum_credits integer,
  max_output_tokens integer,
  is_active boolean,
  auto_router_enabled boolean,
  manual_selection_enabled boolean,
  auto_router_priority integer,
  profit_margin_target numeric,
  usd_to_bdt_rate numeric,
  admin_notes text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz,
  supports_chat boolean,
  supports_image boolean,
  supports_reasoning boolean,
  supports_web boolean,
  supports_coding boolean,
  max_context integer,
  fallback_priority integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorized: admin access required';
  END IF;

  RETURN QUERY SELECT
    m.id, m.provider, m.model_id, m.display_name, m.tier,
    m.input_cost_per_mtok, m.output_cost_per_mtok, m.image_cost_per_image,
    m.credit_multiplier, m.minimum_credits, m.max_output_tokens,
    m.is_active, m.auto_router_enabled, m.manual_selection_enabled,
    m.auto_router_priority, m.profit_margin_target, m.usd_to_bdt_rate,
    m.admin_notes, m.sort_order, m.created_at, m.updated_at,
    m.supports_chat, m.supports_image, m.supports_reasoning, m.supports_web,
    m.supports_coding, m.max_context, m.fallback_priority
  FROM public.ai_models m
  ORDER BY m.sort_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_all_models() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_all_models() TO authenticated;
/*
# Task 3: Update model IDs to OpenRouter format + Smart AI + cost tier

## Summary
Updates all chat model_id values from native provider API IDs to verified OpenRouter model IDs.
Repurposes the "OpenRouter Auto" entry as "Smart AI" (openrouter/auto).
Deletes the leftover "Evil" test model.
Creates a text-based app_settings table for string config values like smart_ai_cost_tier.
Updates pricing fields to match current OpenRouter pricing.

## All changes:
1. Update model_id and pricing for each chat model to match verified OpenRouter catalog entries
2. Repurpose the "OpenRouter Auto" row as "Smart AI":
   - display_name = 'Smart AI'
   - model_id = 'openrouter/auto'
   - manual_selection_enabled = false (not manually selectable)
   - auto_router_enabled = false (not a fallback candidate)
   - minimum_credits = 1 (pre-charge floor; actual cost settled after response)
3. Delete the "Evil" test model
4. Create app_settings table for text-based configuration (smart_ai_cost_tier = low)

## Security
- app_settings table has RLS enabled with admin-only write, authenticated read
- No schema changes to ai_models or system_config

## Important notes:
1. All OpenRouter model IDs verified against live OpenRouter API (https://openrouter.ai/api/v1/models)
2. Pricing values reflect current OpenRouter per-token pricing (converted to per-million-tokens)
3. Image models (DALL-E) NOT changed — they bypass OpenRouter
4. smart_ai_cost_tier stored in new app_settings table (system_config only accepts numeric values)
*/

-- ─── Update chat model IDs and pricing to OpenRouter format ───

UPDATE ai_models SET
  model_id = 'openai/gpt-4o-mini',
  input_cost_per_mtok = 0.15,
  output_cost_per_mtok = 0.60
WHERE model_id = 'gpt-4o-mini' AND provider = 'openai';

UPDATE ai_models SET
  model_id = 'openai/gpt-4o',
  input_cost_per_mtok = 2.50,
  output_cost_per_mtok = 10.00
WHERE model_id = 'gpt-4o' AND provider = 'openai';

UPDATE ai_models SET
  model_id = 'openai/o1',
  display_name = 'o1',
  input_cost_per_mtok = 15.00,
  output_cost_per_mtok = 60.00
WHERE model_id = 'o1-preview' AND provider = 'openai';

UPDATE ai_models SET
  model_id = 'openai/o3-mini',
  display_name = 'o3 Mini',
  input_cost_per_mtok = 1.10,
  output_cost_per_mtok = 4.40
WHERE model_id = 'o1-mini' AND provider = 'openai';

UPDATE ai_models SET
  model_id = 'google/gemini-2.5-flash',
  input_cost_per_mtok = 0.30,
  output_cost_per_mtok = 2.50
WHERE model_id = 'gemini-1.5-flash' AND provider = 'gemini';

UPDATE ai_models SET
  model_id = 'google/gemini-2.5-pro',
  input_cost_per_mtok = 1.25,
  output_cost_per_mtok = 10.00
WHERE model_id = 'gemini-1.5-pro' AND provider = 'gemini';

UPDATE ai_models SET
  model_id = 'google/gemini-2.5-flash',
  display_name = 'Gemini 2.5 Flash',
  input_cost_per_mtok = 0.30,
  output_cost_per_mtok = 2.50
WHERE model_id = 'gemini-2.0-flash' AND provider = 'gemini';

UPDATE ai_models SET
  model_id = 'anthropic/claude-sonnet-4.5',
  display_name = 'Claude Sonnet 4.5',
  input_cost_per_mtok = 3.00,
  output_cost_per_mtok = 15.00
WHERE model_id = 'claude-3-5-sonnet' AND provider = 'claude';

UPDATE ai_models SET
  model_id = 'anthropic/claude-3-haiku',
  display_name = 'Claude Haiku',
  input_cost_per_mtok = 0.25,
  output_cost_per_mtok = 1.25
WHERE model_id = 'claude-3-haiku' AND provider = 'claude';

UPDATE ai_models SET
  model_id = 'anthropic/claude-opus-4.5',
  display_name = 'Claude Opus 4.5',
  input_cost_per_mtok = 5.00,
  output_cost_per_mtok = 25.00
WHERE model_id = 'claude-3-opus' AND provider = 'claude';

UPDATE ai_models SET
  model_id = 'deepseek/deepseek-chat',
  display_name = 'DeepSeek Chat',
  input_cost_per_mtok = 0.27,
  output_cost_per_mtok = 1.03
WHERE model_id = 'deepseek-chat' AND provider = 'deepseek';

UPDATE ai_models SET
  model_id = 'deepseek/deepseek-r1',
  display_name = 'DeepSeek R1',
  input_cost_per_mtok = 0.70,
  output_cost_per_mtok = 2.50
WHERE model_id = 'deepseek-reasoner' AND provider = 'deepseek';

UPDATE ai_models SET
  model_id = 'x-ai/grok-4.20',
  display_name = 'Grok 4.20',
  input_cost_per_mtok = 1.25,
  output_cost_per_mtok = 2.50
WHERE model_id = 'grok-2' AND provider = 'grok';

UPDATE ai_models SET
  model_id = 'x-ai/grok-4.3',
  display_name = 'Grok 4.3',
  input_cost_per_mtok = 1.25,
  output_cost_per_mtok = 2.50
WHERE model_id = 'grok-2-mini' AND provider = 'grok';

UPDATE ai_models SET
  model_id = 'moonshotai/kimi-k2',
  display_name = 'Kimi K2',
  input_cost_per_mtok = 0.57,
  output_cost_per_mtok = 2.30
WHERE model_id = 'moonshot-v1-8k' AND provider = 'kimi';

UPDATE ai_models SET
  model_id = 'moonshotai/kimi-k2.6',
  display_name = 'Kimi K2.6',
  input_cost_per_mtok = 0.95,
  output_cost_per_mtok = 4.00
WHERE model_id = 'moonshot-v1-32k' AND provider = 'kimi';

-- ─── Repurpose OpenRouter Auto as Smart AI ───

UPDATE ai_models SET
  display_name = 'Smart AI',
  model_id = 'openrouter/auto',
  manual_selection_enabled = false,
  auto_router_enabled = false,
  minimum_credits = 1,
  input_cost_per_mtok = 0,
  output_cost_per_mtok = 0,
  supports_chat = true,
  supports_image = false
WHERE model_id = 'auto' AND provider = 'openrouter';

-- ─── Delete the Evil test model ───

DELETE FROM ai_models WHERE model_id = 'test-evil' AND provider = 'openai';

-- ─── Create app_settings table for text-based config ───

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_write_app_settings" ON app_settings;
CREATE POLICY "admin_write_app_settings" ON app_settings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "authenticated_read_app_settings" ON app_settings;
CREATE POLICY "authenticated_read_app_settings" ON app_settings
  FOR SELECT TO authenticated USING (true);

INSERT INTO app_settings (key, value, description)
VALUES ('smart_ai_cost_tier', 'low', 'OpenRouter Auto Router cost tier: low, medium, high, xhigh, max')
ON CONFLICT (key) DO UPDATE SET value = 'low', description = 'OpenRouter Auto Router cost tier: low, medium, high, xhigh, max';
/*
# Task 3: Update user_models view with provider_label

## Summary
Recreates the user_models view to include a provider_label column that shows
a user-friendly provider name (e.g., "OpenAI", "Anthropic", "Google") for grouping
in the model selector dropdown. The raw provider column is NOT exposed — only
the display label.

## Changes:
1. Drop and recreate user_models view
2. New column: provider_label (text) — derived from provider via CASE mapping
3. Also filters to only show models where supports_chat = true (chat models only)
   and excludes image models from the chat selector
4. Excludes the Smart AI entry (manual_selection_enabled = false) from the
   manual selection list — it's accessed via the Smart AI button, not the dropdown

## Security:
- View remains read-only (no INSERT/UPDATE/DELETE policies needed on views)
- Only safe fields are exposed: id, display_name, provider_label, tier,
  minimum_credits, supports_reasoning, supports_coding, supports_web,
  max_context, sort_order
- No pricing, model_id, provider, costs, multipliers, or profit fields exposed
*/

DROP VIEW IF EXISTS user_models;

CREATE VIEW user_models AS
SELECT
  id,
  display_name,
  CASE provider
    WHEN 'openai' THEN 'OpenAI'
    WHEN 'gemini' THEN 'Google'
    WHEN 'claude' THEN 'Anthropic'
    WHEN 'grok' THEN 'xAI'
    WHEN 'deepseek' THEN 'DeepSeek'
    WHEN 'kimi' THEN 'Kimi'
    WHEN 'openrouter' THEN 'OpenRouter'
    ELSE initcap(provider)
  END AS provider_label,
  tier,
  minimum_credits,
  manual_selection_enabled,
  supports_chat,
  supports_image,
  supports_reasoning,
  supports_web,
  supports_coding,
  max_context,
  sort_order
FROM ai_models
WHERE is_active = true
  AND supports_chat = true
  AND manual_selection_enabled = true;

GRANT SELECT ON user_models TO authenticated;
/*
# Task 3: Fix calculate_credit_cost to not leak api_cost_usd

## Summary
The calculate_credit_cost RPC function returns api_cost_usd in its result,
which exposes internal API cost information to normal users. This replaces
the api_cost_usd column with a NULL value (kept for return type compatibility)
so the frontend can still call the function without seeing actual costs.

## Changes:
1. Modify calculate_credit_cost to return NULL for api_cost_usd instead of the real value
2. The credits and model_display_name fields remain unchanged

## Security:
- Internal API costs are no longer exposed to normal users via this RPC
- The return type signature stays the same for backward compatibility
- The frontend only uses credits and model_display_name from the result
*/

CREATE OR REPLACE FUNCTION public.calculate_credit_cost(
  p_model_id text,
  p_input_tokens integer DEFAULT 0,
  p_output_tokens integer DEFAULT 0,
  p_request_type text DEFAULT 'chat'
)
RETURNS TABLE(credits integer, api_cost_usd numeric, model_display_name text, pricing_rule text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_model public.ai_models%ROWTYPE;
  v_api_cost_usd numeric;
  v_api_cost_bdt numeric;
  v_credits integer;
  v_min_charge integer;
  v_usd_to_bdt numeric;
BEGIN
  SELECT * INTO v_model
  FROM public.ai_models
  WHERE model_id = p_model_id OR id::text = p_model_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Model not found: %', p_model_id;
  END IF;

  SELECT COALESCE(value, 1) INTO v_min_charge
  FROM public.system_config
  WHERE key = 'minimum_credit_charge';

  v_usd_to_bdt := v_model.usd_to_bdt_rate;

  IF p_request_type = 'image' THEN
    v_api_cost_usd := v_model.image_cost_per_image;
    v_api_cost_bdt := v_api_cost_usd * v_usd_to_bdt;
    v_credits := GREATEST(
      v_model.minimum_credits,
      CEIL(v_api_cost_bdt * v_model.credit_multiplier),
      v_min_charge
    );
    RETURN QUERY SELECT v_credits, NULL::numeric, v_model.display_name, 'image_fixed'::text;
  ELSE
    v_api_cost_usd := (
      p_input_tokens * v_model.input_cost_per_mtok +
      p_output_tokens * v_model.output_cost_per_mtok
    ) / 1000000.0;
    v_api_cost_bdt := v_api_cost_usd * v_usd_to_bdt;
    v_credits := GREATEST(
      v_model.minimum_credits,
      CEIL(v_api_cost_bdt * v_model.credit_multiplier),
      v_min_charge
    );
    RETURN QUERY SELECT v_credits, NULL::numeric, v_model.display_name, 'token_based'::text;
  END IF;
END;
$function$;
/*
# Task 3: API Key Management via Supabase Vault

## Summary
Stores API keys (OPENROUTER_API_KEY, OPENAI_API_KEY) in Supabase Vault so they
can be edited from the admin panel without code changes. Provides admin-only
RPC functions to set and check whether keys are configured.

## Security:
- Keys stored encrypted in vault.secrets (Supabase Vault uses pgsodium)
- Only admin users can set or read keys via SECURITY DEFINER RPC functions
- The edge function reads keys via a SECURITY DEFINER function using service role
- Non-admin users can only check whether a key is set (boolean), never see the value
- RLS on vault.secrets denies all access to anon and authenticated roles
*/

-- ─── RPC: Set an API key (admin only) ───

CREATE OR REPLACE FUNCTION public.set_api_key(p_key_name text, p_value text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Permission denied: admin access required';
  END IF;

  IF p_value IS NULL OR length(trim(p_value)) = 0 THEN
    RAISE EXCEPTION 'API key value cannot be empty';
  END IF;

  DELETE FROM vault.secrets WHERE name = p_key_name;

  INSERT INTO vault.secrets (name, secret, description)
  VALUES (p_key_name, p_value, 'API key for ' || p_key_name);

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_api_key(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_api_key(text, text) TO authenticated;

-- ─── RPC: Check if an API key is set (admin only) ───

CREATE OR REPLACE FUNCTION public.check_api_key(p_key_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  v_is_admin boolean;
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Permission denied: admin access required';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = p_key_name
  ) INTO v_exists;

  RETURN v_exists;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_api_key(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_api_key(text) TO authenticated;

-- ─── RPC: Get API key value (service-role only, no user access) ───

CREATE OR REPLACE FUNCTION public.get_api_key(p_key_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE
  v_value text;
BEGIN
  SELECT secret INTO v_value FROM vault.secrets WHERE name = p_key_name LIMIT 1;
  RETURN v_value;
END;
$function$;

-- Only service role can call this (not available to authenticated or anon)
REVOKE ALL ON FUNCTION public.get_api_key(text) FROM anon, authenticated;
