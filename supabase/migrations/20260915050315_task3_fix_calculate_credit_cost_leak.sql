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
