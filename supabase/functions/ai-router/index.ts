import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AIModel {
  id: string;
  provider: string;
  model_id: string;
  display_name: string;
  tier: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
  image_cost_per_image: number;
  credit_multiplier: number;
  minimum_credits: number;
  max_output_tokens: number;
  is_active: boolean;
  auto_router_enabled: boolean;
  manual_selection_enabled: boolean;
  auto_router_priority: number;
  profit_margin_target: number;
  usd_to_bdt_rate: number;
  supports_chat: boolean;
  supports_image: boolean;
  supports_reasoning: boolean;
  supports_web: boolean;
  supports_coding: boolean;
  max_context: number;
  fallback_priority: number;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ─── Credit calculation ───

function calculateCredits(
  model: AIModel,
  inputTokens: number,
  outputTokens: number,
): { credits: number; apiCostUsd: number; apiCostBdt: number } {
  if (model.provider === "image") {
    const apiCostUsd = model.image_cost_per_image;
    const apiCostBdt = apiCostUsd * model.usd_to_bdt_rate;
    const credits = Math.max(model.minimum_credits, Math.ceil(apiCostBdt * model.credit_multiplier));
    return { credits, apiCostUsd, apiCostBdt };
  }

  const apiCostUsd =
    (inputTokens * model.input_cost_per_mtok + outputTokens * model.output_cost_per_mtok) / 1_000_000;
  const apiCostBdt = apiCostUsd * model.usd_to_bdt_rate;
  const credits = Math.max(model.minimum_credits, Math.ceil(apiCostBdt * model.credit_multiplier));
  return { credits, apiCostUsd, apiCostBdt };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── OpenRouter API call ───

interface OpenRouterResult {
  content: string;
  imageUrl?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  finishReason: string;
  modelUsed: string;
}

async function callOpenRouter(
  modelId: string,
  messages: ChatMessage[],
  maxTokens: number,
  apiKey: string,
  costTier?: string,
  allowedModels?: string[],
): Promise<OpenRouterResult> {
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    max_tokens: maxTokens,
  };

  if (modelId === "openrouter/auto") {
    const plugin: Record<string, unknown> = { id: "auto-router" };
    if (costTier) plugin.cost_tier = costTier;
    if (allowedModels && allowedModels.length > 0) plugin.allowed_models = allowedModels;
    body.plugins = [plugin];
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error: ${err}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
    finishReason: data.choices?.[0]?.finish_reason ?? "stop",
    modelUsed: data.model ?? modelId,
  };
}

// ─── Image generation (direct OpenAI DALL-E, unchanged) ───

async function callImageModel(modelId: string, prompt: string, apiKey: string): Promise<OpenRouterResult> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, prompt, n: 1, size: modelId === "dall-e-3" ? "1024x1024" : "256x256" }),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Image API error: ${err}`); }
  const data = await res.json();
  return {
    content: data.data?.[0]?.url ?? "",
    imageUrl: data.data?.[0]?.url ?? "",
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    finishReason: "image_generated",
    modelUsed: modelId,
  };
}

// ─── Main handler ───

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // State for error handler
  let profile: { paid_credits: number; free_credits: number } | null = null;
  let preChargeAmount = 0;
  let userId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    userId = userData.user.id;

    // Parse request
    const body = await req.json();
    const { messages, mode, selectedModel } = body as {
      messages?: ChatMessage[];
      mode?: "auto" | "manual";
      selectedModel?: string;
    };

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const effectiveMode = mode ?? "auto";

    // Load all active models
    const { data: models, error: modelsError } = await supabase
      .from("ai_models")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    if (modelsError || !models) {
      return new Response(JSON.stringify({ error: "Failed to load models" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allModels = models as AIModel[];

    // Check user credit balance
    const { data: profileData } = await supabase
      .from("profiles")
      .select("paid_credits, free_credits, total_credits_used")
      .eq("id", userId)
      .maybeSingle();
    profile = profileData;
    const availableCredits = (profile?.paid_credits ?? 0) + (profile?.free_credits ?? 0);

    const lastUserMsg = [...messages].reverse().find(m => m.role === "user")!;

    // ─── Image generation path (unchanged, direct OpenAI) ───
    if (effectiveMode === "manual" && selectedModel) {
      const imageModel = allModels.find(m =>
        m.id === selectedModel && m.provider === "image" && m.supports_image
      );
      if (imageModel) {
        const { data: openaiKeyData } = await supabase.rpc("get_api_key", { p_key_name: "OPENAI_API_KEY" });
        const openaiKey = (openaiKeyData as string) ?? "";
        if (!openaiKey) throw new Error("Image generation API key not configured. Please set it in the admin panel.");

        const imageEstimate = calculateCredits(imageModel, 0, 0);
        if (availableCredits < imageEstimate.credits) {
          return new Response(JSON.stringify({
            error: "Insufficient credits. Please add more credits to continue.",
            required: imageEstimate.credits,
            available: availableCredits,
            model: imageModel.display_name,
          }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const imageResult = await callImageModel(imageModel.model_id, lastUserMsg.content, openaiKey);
        const actualCalc = calculateCredits(imageModel, 0, 0);
        const creditsToCharge = Math.max(imageEstimate.credits, actualCalc.credits);

        const requestId = crypto.randomUUID();
        const { data: deductResult, error: deductError } = await supabase.rpc("deduct_credits", {
          p_user_id: userId,
          p_amount: creditsToCharge,
          p_provider: "image",
          p_model: imageResult.modelUsed,
          p_mode: "manual",
          p_input_tokens: 0,
          p_output_tokens: 0,
          p_total_tokens: 0,
          p_api_cost_usd: actualCalc.apiCostUsd,
          p_usd_to_bdt_rate: imageModel.usd_to_bdt_rate,
          p_bdt_cost: actualCalc.apiCostBdt,
        });

        if (deductError) {
          return new Response(JSON.stringify({ error: "Failed to process credit deduction. Please try again." }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newBalance = deductResult as number;
        if (newBalance === -1) {
          return new Response(JSON.stringify({
            error: "Insufficient credits. Please add more credits to continue.",
            required: creditsToCharge,
            available: availableCredits,
            model: imageModel.display_name,
          }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          content: imageResult.content,
          imageUrl: imageResult.imageUrl ?? null,
          model: imageModel.display_name,
          mode: "manual",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          credits: { charged: creditsToCharge, remaining: newBalance },
          requestId,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ─── Chat path: Smart AI or exact model selection ───

    const { data: openrouterKeyData } = await supabase.rpc("get_api_key", { p_key_name: "OPENROUTER_API_KEY" });
    const openrouterKey = (openrouterKeyData as string) ?? "";
    if (!openrouterKey) throw new Error("OpenRouter API key not configured. Please set it in the admin panel.");

    // Get Smart AI cost tier from app_settings
    const { data: settingsData } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "smart_ai_cost_tier")
      .maybeSingle();
    const costTier = settingsData?.value ?? "low";

    let model: AIModel;
    let isSmartAI = false;

    if (effectiveMode === "manual" && selectedModel) {
      // Exact model selection: validate by UUID only
      const found = allModels.find(m => m.id === selectedModel);
      if (!found) {
        return new Response(JSON.stringify({ error: "Selected model not available" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!found.manual_selection_enabled) {
        return new Response(JSON.stringify({ error: "This model is not available for manual selection" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!found.supports_chat) {
        return new Response(JSON.stringify({ error: "This model does not support chat" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      model = found;
    } else {
      // Smart AI: use openrouter/auto
      const smartAI = allModels.find(m => m.model_id === "openrouter/auto");
      if (!smartAI) throw new Error("Smart AI model not configured");
      model = smartAI;
      isSmartAI = true;
    }

    // ─── Credit reservation ───
    // For exact model: estimate based on model pricing
    // For Smart AI: reserve the max possible charge across all active chat models
    //   to ensure the user can cover any model OpenRouter Auto might select

    let reservedCredits: number;

    if (isSmartAI) {
      // Find the maximum credit cost across all active chat models that Smart AI might use
      const estInputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      const estOutputTokens = Math.min(model.max_output_tokens, 1000);

      const chatModels = allModels.filter(m =>
        m.supports_chat && m.provider !== "image" && m.provider !== "openrouter"
      );

      if (chatModels.length === 0) {
        // Fallback: use Smart AI's own minimum_credits
        reservedCredits = model.minimum_credits;
      } else {
        // Calculate the max possible charge across all models
        const maxCharge = Math.max(
          ...chatModels.map(m => {
            const calc = calculateCredits(m, estInputTokens, estOutputTokens);
            return calc.credits;
          })
        );
        // Reserve the max, but at least Smart AI's minimum_credits
        reservedCredits = Math.max(model.minimum_credits, maxCharge);
      }
    } else {
      // Exact model: estimate based on the selected model's pricing
      const estInputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      const estOutputTokens = Math.min(model.max_output_tokens, 1000);
      const estimate = calculateCredits(model, estInputTokens, estOutputTokens);
      reservedCredits = estimate.credits;
    }

    // Check if user can cover the reservation
    if (availableCredits < reservedCredits) {
      return new Response(JSON.stringify({
        error: "Insufficient credits. Please add more credits to continue.",
        required: reservedCredits,
        available: availableCredits,
        model: isSmartAI ? "Smart AI" : model.display_name,
      }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-charge: deduct the reserved credits
    preChargeAmount = reservedCredits;
    const requestId = crypto.randomUUID();
    const { data: preChargeResult, error: preChargeError } = await supabase.rpc("deduct_credits", {
      p_user_id: userId,
      p_amount: reservedCredits,
      p_provider: isSmartAI ? "openrouter" : model.provider,
      p_model: isSmartAI ? "openrouter/auto" : model.model_id,
      p_mode: effectiveMode,
      p_input_tokens: null,
      p_output_tokens: null,
      p_total_tokens: null,
      p_api_cost_usd: null,
      p_usd_to_bdt_rate: model.usd_to_bdt_rate,
      p_bdt_cost: null,
    });

    if (preChargeError) {
      return new Response(JSON.stringify({ error: "Failed to process credit reservation. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const balanceAfterPreCharge = preChargeResult as number;
    if (balanceAfterPreCharge === -1) {
      return new Response(JSON.stringify({
        error: "Insufficient credits. Please add more credits to continue.",
        required: reservedCredits,
        available: availableCredits,
        model: isSmartAI ? "Smart AI" : model.display_name,
      }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Call OpenRouter ───
    const openRouterModelId = isSmartAI ? "openrouter/auto" : model.model_id;

    // Build allowed_models list for Smart AI: only registered, active chat models
    let allowedModels: string[] | undefined;
    if (isSmartAI) {
      allowedModels = allModels
        .filter(m => m.supports_chat && m.provider !== "image" && m.provider !== "openrouter" && m.is_active)
        .map(m => m.model_id);
    }

    const result = await callOpenRouter(
      openRouterModelId,
      messages,
      model.max_output_tokens,
      openrouterKey,
      isSmartAI ? costTier : undefined,
      isSmartAI ? allowedModels : undefined,
    );

    // ─── Settlement: calculate actual credits and reconcile ───

    let actualModel: AIModel;
    let actualCredits: number;

    if (isSmartAI) {
      // OpenRouter Auto: find the actual model used in our registry
      const actualModelEntry = allModels.find(m => m.model_id === result.modelUsed);
      if (!actualModelEntry) {
        // Unknown model returned despite allowed_models restriction.
        // Refund the full reservation and reject — never undercharge.
        await supabase.rpc("refund_credits", {
          p_user_id: userId,
          p_amount: reservedCredits,
          p_description: `Rejected unknown model from Smart AI: ${result.modelUsed}`,
        });
        return new Response(JSON.stringify({
          error: "Smart AI routed to an unregistered model. Please try again or select a specific model.",
        }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      actualModel = actualModelEntry;
    } else {
      actualModel = model;
    }

    const actualCalc = calculateCredits(actualModel, result.inputTokens, result.outputTokens);
    actualCredits = actualCalc.credits;

    // Reconcile: if actual < reserved, refund the difference
    // If actual > reserved, deduct the difference
    let finalBalance = balanceAfterPreCharge;

    if (actualCredits < reservedCredits) {
      const refundAmount = reservedCredits - actualCredits;
      const { data: refundResult } = await supabase.rpc("refund_credits", {
        p_user_id: userId,
        p_amount: refundAmount,
        p_description: `Settlement refund: reserved ${reservedCredits}, actual ${actualCredits} (${actualModel.display_name})`,
      });
      finalBalance = refundResult as number;
    } else if (actualCredits > reservedCredits) {
      const extraCharge = actualCredits - reservedCredits;
      const { data: extraResult, error: extraError } = await supabase.rpc("deduct_credits", {
        p_user_id: userId,
        p_amount: extraCharge,
        p_provider: actualModel.provider,
        p_model: result.modelUsed,
        p_mode: effectiveMode,
        p_input_tokens: result.inputTokens,
        p_output_tokens: result.outputTokens,
        p_total_tokens: result.totalTokens,
        p_api_cost_usd: actualCalc.apiCostUsd,
        p_usd_to_bdt_rate: actualModel.usd_to_bdt_rate,
        p_bdt_cost: actualCalc.apiCostBdt,
      });
      if (extraError || extraResult === -1) {
        // Can't charge extra — user already got the response, log but don't block
        finalBalance = balanceAfterPreCharge;
      } else {
        finalBalance = extraResult as number;
      }
    }

    // Return success — user sees the display name, not the internal model ID
    const displayName = isSmartAI
      ? (allModels.find(m => m.model_id === result.modelUsed)?.display_name ?? "Smart AI")
      : model.display_name;

    return new Response(JSON.stringify({
      content: result.content,
      imageUrl: null,
      model: displayName,
      mode: effectiveMode,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
      },
      credits: {
        charged: actualCredits,
        remaining: finalBalance,
      },
      requestId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // If credits were pre-charged but the request failed, refund the full reservation
    try {
      if (userId && preChargeAmount > 0) {
        await supabase.rpc("refund_credits", {
          p_user_id: userId,
          p_amount: preChargeAmount,
          p_description: `Refund for failed request: ${message}`,
        });
      }
    } catch {
      // Refund failed — logged but not exposed to user
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
