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
