import { supabase } from '@/lib/supabase';
import type { AIModel, CreditTransaction } from '@/lib/types';

export type ChatResponse = {
  content: string;
  imageUrl: string | null;
  model: string;
  mode: 'auto' | 'manual';
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  credits: {
    charged: number;
    remaining: number;
  };
  requestId: string;
};

export async function fetchModels(): Promise<AIModel[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('user_models')
    .select('*')
    .order('sort_order');
  if (error) return [];
  return (data as AIModel[]) ?? [];
}

export async function fetchAllModels(): Promise<AIModel[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_all_models');
  if (error) return [];
  return (data as AIModel[]) ?? [];
}

export async function calculateCreditCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  requestType: 'chat' | 'image',
): Promise<{ credits: number; api_cost_usd: number; model_display_name: string; pricing_rule: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('calculate_credit_cost', {
    p_model_id: modelId,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
    p_request_type: requestType,
  });
  if (error) return null;
  return data as { credits: number; api_cost_usd: number; model_display_name: string; pricing_rule: string } | null;
}

export async function saveModelAdmin(model: Partial<AIModel> & { isNew?: boolean }): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Backend not configured' };
  const { error } = await supabase.rpc('save_ai_model', {
    p_id: model.id ?? null,
    p_provider: model.provider ?? 'openai',
    p_model_id: model.model_id ?? '',
    p_display_name: model.display_name ?? '',
    p_tier: model.tier ?? 'economy',
    p_input_cost_per_mtok: model.input_cost_per_mtok ?? 0,
    p_output_cost_per_mtok: model.output_cost_per_mtok ?? 0,
    p_image_cost_per_image: model.image_cost_per_image ?? 0,
    p_credit_multiplier: model.credit_multiplier ?? 2.0,
    p_minimum_credits: model.minimum_credits ?? 1,
    p_max_output_tokens: model.max_output_tokens ?? 4096,
    p_is_active: model.is_active ?? true,
    p_auto_router_enabled: model.auto_router_enabled ?? true,
    p_manual_selection_enabled: model.manual_selection_enabled ?? true,
    p_auto_router_priority: model.auto_router_priority ?? 99,
    p_fallback_priority: model.fallback_priority ?? 99,
    p_profit_margin_target: model.profit_margin_target ?? 0.50,
    p_usd_to_bdt_rate: model.usd_to_bdt_rate ?? 127,
    p_admin_notes: model.admin_notes ?? null,
    p_sort_order: model.sort_order ?? 0,
    p_supports_chat: model.supports_chat ?? true,
    p_supports_image: model.supports_image ?? false,
    p_supports_reasoning: model.supports_reasoning ?? false,
    p_supports_web: model.supports_web ?? false,
    p_supports_coding: model.supports_coding ?? false,
    p_max_context: model.max_context ?? 4096,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function deleteModelAdmin(id: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Backend not configured' };
  const { error } = await supabase.rpc('delete_ai_model', { p_id: id });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function sendChatRequest(params: {
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  mode: 'auto' | 'manual';
  selectedModel?: string;
}): Promise<{ data?: ChatResponse; error?: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!supabaseUrl || !anonKey) {
    return { error: 'Backend not configured. Please check your environment.' };
  }

  const { data: sessionData } = await supabase?.auth.getSession() ?? { data: null };
  const accessToken = sessionData?.session?.access_token ?? anonKey;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/ai-router`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        messages: params.messages,
        mode: params.mode,
        selectedModel: params.selectedModel,
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      return { error: json.error ?? `Request failed (${res.status})` };
    }

    return { data: json as ChatResponse };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { error: message };
  }
}

export async function fetchCreditTransactions(limit = 20): Promise<CreditTransaction[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data as CreditTransaction[]) ?? [];
}

export async function fetchProfileCredits(): Promise<{ free: number; paid: number; used: number }> {
  if (!supabase) return { free: 0, paid: 0, used: 0 };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { free: 0, paid: 0, used: 0 };
  const { data, error } = await supabase
    .from('profiles')
    .select('free_credits, paid_credits, total_credits_used')
    .maybeSingle();
  if (error) return { free: 0, paid: 0, used: 0 };
  return {
    free: data?.free_credits ?? 0,
    paid: data?.paid_credits ?? 0,
    used: data?.total_credits_used ?? 0,
  };
}

export async function purchaseCredits(amount: number): Promise<{ success: boolean; newBalance: number; error?: string }> {
  if (!supabase) return { success: false, newBalance: 0, error: 'Backend not configured' };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.user) return { success: false, newBalance: 0, error: 'Not signed in' };

  const userId = sessionData.session.user.id;

  // Call secure RPC function — never modify credit columns directly from the frontend
  const { data: newBalance, error } = await supabase.rpc('add_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_source: 'purchase',
    p_description: `Credit purchase: ${amount} credits`,
  });

  if (error) {
    return { success: false, newBalance: 0, error: 'Could not add credits. Please try again.' };
  }

  return { success: true, newBalance: newBalance as number };
}
