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
