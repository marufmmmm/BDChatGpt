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
