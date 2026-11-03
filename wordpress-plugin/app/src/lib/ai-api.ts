import { wpRequest, wpStream, ApiError } from '@/lib/wp';
import type { AIModel, CreditTransaction } from '@/lib/types';

export type ChatResponse = {
  content: string;
  imageUrl: string | null;
  model: string;
  mode: 'auto' | 'manual';
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  credits: { charged: number; remaining: number };
  threadId?: number;
  messageId?: number;
  requestId?: string;
  debug?: { search: boolean; citations: number; model: string; switch?: string; hint?: string; needs?: string; flags?: string } | null;
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Network error';
}

/** Active models for the dropdowns (chat and image both come back; screens filter by supports_*). */
export async function fetchModels(): Promise<AIModel[]> {
  try {
    return await wpRequest<AIModel[]>('models');
  } catch {
    return [];
  }
}

export async function fetchAllModels(): Promise<AIModel[]> {
  try {
    return await wpRequest<AIModel[]>('admin/models');
  } catch {
    return [];
  }
}

/** Prices are calculated on the server. The browser never computes a charge. */
export async function calculateCreditCost(): Promise<null> {
  return null;
}

export async function saveModelAdmin(model: Partial<AIModel> & { isNew?: boolean }): Promise<{ success: boolean; error?: string }> {
  try {
    await wpRequest('admin/models', {
      body: {
        id: model.id ? Number(model.id) : 0,
        model_id: model.model_id ?? '',
        provider: model.provider ?? 'openrouter',
        display_name: model.display_name ?? '',
        kind: model.supports_image ? 'image' : 'chat',
        input_cost_per_mtok: model.input_cost_per_mtok ?? 0,
        output_cost_per_mtok: model.output_cost_per_mtok ?? 0,
        image_cost_per_image: model.image_cost_per_image ?? 0,
        credit_multiplier: model.credit_multiplier ?? 2,
        minimum_credits: model.minimum_credits ?? 1,
        max_output_tokens: model.max_output_tokens ?? 4096,
        is_active: model.is_active ?? true,
        manual_selection_enabled: model.manual_selection_enabled ?? true,
        sort_order: model.sort_order ?? 0,
      },
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: errorText(err) };
  }
}

export async function deleteModelAdmin(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await wpRequest(`admin/models/${Number(id)}`, { method: 'DELETE' });
    return { success: true };
  } catch (err) {
    return { success: false, error: errorText(err) };
  }
}

/** Chat request. selectedModel is the model row id from fetchModels(). */
export type ChatEnvironment = { key: string; name: string };

/** Smart AI plus one Smart environment per provider group that has active models. */
export async function fetchEnvironments(): Promise<ChatEnvironment[]> {
  try {
    return await wpRequest<ChatEnvironment[]>('environments');
  } catch {
    return [{ key: 'smart', name: 'Smart AI' }];
  }
}

/**
 * Start a reply on the server and check it every 2 seconds until it is ready.
 * Each check is short, so slow replies do not hit the server's gateway timeout.
 */
/** Off: replies come straight from the server (the way they worked before). On: background jobs with polling. */
const USE_BACKGROUND_JOBS = false;

async function runJob(startPath: string, payload: unknown): Promise<ChatResponse> {
  if (!USE_BACKGROUND_JOBS) {
    return wpRequest<ChatResponse>(startPath.replace(/\/start$/, ''), { method: 'POST', body: payload });
  }
  const { jobId } = await wpRequest<{ jobId: string }>(startPath, { method: 'POST', body: payload });
  const began = Date.now();
  while (Date.now() - began < 10 * 60 * 1000) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    let job: { status: 'queued' | 'running' | 'done' | 'error'; result?: ChatResponse; error?: string };
    try {
      // A check that hangs for 20 seconds is abandoned, and the next check is sent.
      job = await Promise.race([
        wpRequest<typeof job>(`job?jobId=${encodeURIComponent(jobId)}`),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('slow check')), 20000)),
      ]);
    } catch (err) {
      // Real server answers (such as "not found") stop the wait; slow or dropped checks are retried.
      if ((err as { status?: number }).status === 404) throw err;
      continue;
    }
    if (job.status === 'done' && job.result) return job.result;
    if (job.status === 'error') throw new Error(job.error || 'Request failed');
  }
  throw new Error('The reply is taking too long. Please try again.');
}

export type StreamHandlers = { onDelta: (text: string) => void; onStatus: (text: string) => void };

/** Chat with streaming: text is passed to onDelta as it is written, and onStatus shows each step. */
export async function streamChat(
  params: {
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
    mode: 'auto' | 'manual';
    selectedModel?: string;
    environment?: string;
    language?: 'auto' | 'bangla' | 'english';
    threadId?: number;
    tools?: { webSearch: boolean; datetime: boolean; webFetch: boolean; advisor: boolean; fusion: boolean; subagent: boolean };
  },
  handlers: StreamHandlers,
): Promise<{ data?: ChatResponse; error?: string }> {
  try {
    const res = await wpStream('chat/stream', {
      messages: params.messages,
      tools: params.tools,
      mode: params.mode,
      selectedModelId: params.selectedModel ? Number(params.selectedModel) : undefined,
      environment: params.mode === 'auto' ? (params.environment ?? 'smart') : undefined,
      language: params.language ?? 'auto',
      threadId: params.threadId,
    });
    if (!res.ok || !res.body) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      return { error: j.message ?? `Request failed (${res.status})` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: ChatResponse | undefined;
    let failure: string | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line) continue;
        const ev = JSON.parse(line) as { t: string; text?: string; result?: ChatResponse; message?: string };
        if (ev.t === 'delta' && ev.text) handlers.onDelta(ev.text);
        else if (ev.t === 'status' && ev.text) handlers.onStatus(ev.text);
        else if (ev.t === 'done') final = ev.result;
        else if (ev.t === 'error') failure = ev.message ?? 'Request failed';
      }
    }
    if (failure) return { error: failure };
    if (!final) return { error: 'The reply was interrupted. Please try again.' };
    return { data: final };
  } catch (err) {
    return { error: errorText(err) };
  }
}

export async function sendChatRequest(params: {
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  mode: 'auto' | 'manual';
  selectedModel?: string;
  environment?: string;
  language?: 'auto' | 'bangla' | 'english';
  threadId?: number;
  tools?: { webSearch: boolean; datetime: boolean; webFetch: boolean; advisor: boolean; fusion: boolean; subagent: boolean };
}): Promise<{ data?: ChatResponse; error?: string }> {
  try {
    const data = await runJob('chat/start', {
      messages: params.messages,
      tools: params.tools,
      mode: params.mode,
      selectedModelId: params.selectedModel ? Number(params.selectedModel) : undefined,
      environment: params.mode === 'auto' ? (params.environment ?? 'smart') : undefined,
      language: params.language ?? 'auto',
      threadId: params.threadId,
    });
    return { data };
  } catch (err) {
    return { error: errorText(err) };
  }
}

/** Image generation. prompt is the request text; modelId is the image model row id. */
export async function generateImage(prompt: string, modelId: string, threadId?: number): Promise<{ data?: ChatResponse; error?: string }> {
  try {
    const data = await runJob('image/start', { prompt, selectedModelId: Number(modelId), threadId });
    return { data };
  } catch (err) {
    return { error: errorText(err) };
  }
}

type LedgerRow = { id: number; delta: number; type: string; model: string; description: string; created_at: string };

export async function fetchCreditTransactions(limit = 20): Promise<CreditTransaction[]> {
  try {
    const rows = await wpRequest<LedgerRow[]>(`transactions?limit=${limit}`);
    return rows.map((r) => ({
      id: String(r.id),
      request_id: null,
      provider: null,
      model: r.model || null,
      mode: r.type === 'grant' || r.type === 'bonus' ? 'admin_adjust' : r.type === 'charge' ? 'auto' : 'topup',
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      estimated_api_cost_usd: null,
      actual_api_cost_usd: null,
      usd_to_bdt_rate: null,
      credits_charged: -r.delta,
      description: r.description,
      created_at: r.created_at,
    }) as unknown as CreditTransaction);
  } catch {
    return [];
  }
}

export async function fetchProfileCredits(): Promise<{ free: number; paid: number; used: number }> {
  try {
    const me = await wpRequest<{ credits: { balance: number; used: number } }>('me');
    return { free: me.credits.balance, paid: 0, used: me.credits.used };
  } catch {
    return { free: 0, paid: 0, used: 0 };
  }
}

/** API keys live in wp-config.php. This only reports whether each one is set. */
export async function checkApiKey(keyName: string): Promise<boolean> {
  try {
    const keys = await wpRequest<Record<string, boolean>>('admin/keys');
    return Boolean(keys[keyName]);
  } catch {
    return false;
  }
}

export async function setApiKey(_keyName?: string, _value?: string): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'API keys are set in wp-config.php on the server, not from this screen.' };
}

/** Payments are not connected in this build. Admins grant credits from the admin panel. */
export async function purchaseCredits(_amount: number): Promise<{ success: boolean; newBalance: number; error?: string }> {
  return { success: false, newBalance: 0, error: 'Online payments are not connected yet. Ask the admin to add credits.' };
}

export type RoutingTable = { labels: string[]; envs: Record<string, Record<string, string[]>> };

export async function fetchRouting(): Promise<RoutingTable | null> {
  try {
    return await wpRequest<RoutingTable>('admin/routing');
  } catch {
    return null;
  }
}

export async function saveRouting(env: string, routing: Record<string, string[]>): Promise<RoutingTable> {
  return wpRequest<RoutingTable>('admin/routing', { method: 'POST', body: { env, routing } });
}
