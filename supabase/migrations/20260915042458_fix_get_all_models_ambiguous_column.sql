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
