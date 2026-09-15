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
