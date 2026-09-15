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
