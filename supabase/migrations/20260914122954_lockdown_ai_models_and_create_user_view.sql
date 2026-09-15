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
