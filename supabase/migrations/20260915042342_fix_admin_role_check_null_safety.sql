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
