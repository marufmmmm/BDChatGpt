export type Plan = 'Free' | 'Normal' | 'Medium' | 'Pro';
export type View = 'dashboard' | 'chat' | 'images' | 'usage' | 'explore' | 'subscription' | 'settings' | 'admin';
export type Asset = {
  id: string;
  kind: 'file' | 'image';
  name: string;
  size: string;
  uploaded: string;
  expires: string;
  days: number;
  prompt?: string;
  url?: string;
  model?: string;
};

export type AIProvider = 'openai' | 'gemini' | 'claude' | 'grok' | 'deepseek' | 'kimi' | 'openrouter' | 'image';
export type ModelTier = 'economy' | 'standard' | 'advanced' | 'premium_reasoning' | 'image_fast' | 'image_standard' | 'image_premium' | 'image_ultra_hd';

export type AIModel = {
  id: string;
  provider: AIProvider;
  provider_label?: string;
  model_id: string;
  display_name: string;
  tier: ModelTier;
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
  admin_notes?: string;
  sort_order: number;
  supports_chat: boolean;
  supports_image: boolean;
  supports_reasoning: boolean;
  supports_web: boolean;
  supports_coding: boolean;
  max_context: number;
  fallback_priority: number;
};

export type CreditTransaction = {
  id: string;
  request_id: string | null;
  provider: string | null;
  model: string | null;
  mode: 'auto' | 'manual' | 'topup' | 'admin_adjust';
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_api_cost_usd: number | null;
  actual_api_cost_usd: number | null;
  usd_to_bdt_rate: number | null;
  bdt_cost: number | null;
  credits_charged: number;
  balance_after: number | null;
  status: 'success' | 'failed' | 'pending' | 'refunded';
  created_at: string;
};

export type ChatThread = {
  id: string;
  title: string;
  model: string;
  time: string;
};

export const providerLabels: Record<AIProvider, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  claude: 'Anthropic Claude',
  grok: 'xAI Grok',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  openrouter: 'OpenRouter',
  image: 'Image',
};

export const providerOrder: AIProvider[] = [
  'openai', 'gemini', 'claude', 'grok', 'deepseek', 'kimi', 'openrouter', 'image',
];

export const tierLabels: Record<ModelTier, string> = {
  economy: 'Economy',
  standard: 'Standard',
  advanced: 'Advanced',
  premium_reasoning: 'Premium Reasoning',
  image_fast: 'Image Fast',
  image_standard: 'Image Standard',
  image_premium: 'Image Premium',
  image_ultra_hd: 'Image Ultra HD',
};

export const tierColors: Record<ModelTier, string> = {
  economy: '#10b981',
  standard: '#3b82f6',
  advanced: '#f59e0b',
  premium_reasoning: '#db2777',
  image_fast: '#6366f1',
  image_standard: '#6366f1',
  image_premium: '#db2777',
  image_ultra_hd: '#db2777',
};

export const planDetails: Record<Plan, { price: string; storage: string; maxFile: string; images: number; color: string }> = {
  Free: { price: '৳0', storage: '100 MB', maxFile: '2 MB', images: 2, color: '#64748b' },
  Normal: { price: '৳500', storage: '500 MB', maxFile: '5 MB', images: 10, color: '#6366f1' },
  Medium: { price: '৳800', storage: '1 GB', maxFile: '10 MB', images: 20, color: '#0f766e' },
  Pro: { price: '৳1,200', storage: '2 GB', maxFile: '20 MB', images: 30, color: '#db2777' },
};

export const imagePacks = [
  { id: 'img-100', amount: 100, price: 100, label: '100 credits' },
  { id: 'img-500', amount: 500, price: 500, label: '500 credits' },
  { id: 'img-1000', amount: 1000, price: 1000, label: '1,000 credits' },
  { id: 'img-5000', amount: 5000, price: 5000, label: '5,000 credits' },
];

export const chatPacks = [
  { id: 'chat-100', amount: 100, price: 100, label: '100 credits' },
  { id: 'chat-500', amount: 500, price: 500, label: '500 credits' },
  { id: 'chat-1000', amount: 1000, price: 1000, label: '1,000 credits' },
  { id: 'chat-5000', amount: 5000, price: 5000, label: '5,000 credits' },
];

export const quickActions = [
  { label: 'Chat with AI', desc: 'Ask anything', icon: 'MessageCircle', tone: 'bg-indigo-50 text-indigo-600' },
  { label: 'Generate Image', desc: 'Bring ideas to life', icon: 'Image', tone: 'bg-pink-50 text-pink-600' },
  { label: 'Write Content', desc: 'Create faster', icon: 'FileText', tone: 'bg-amber-50 text-amber-600' },
  { label: 'Analyze Document', desc: 'Get the key points', icon: 'BarChart3', tone: 'bg-emerald-50 text-emerald-600' },
  { label: 'Brainstorm Ideas', desc: 'Think bigger', icon: 'Sparkles', tone: 'bg-cyan-50 text-cyan-600' },
  { label: 'Translate', desc: 'Break language barriers', icon: 'ArrowRight', tone: 'bg-sky-50 text-sky-600' },
  { label: 'Summarize', desc: 'Make it concise', icon: 'Clock3', tone: 'bg-orange-50 text-orange-600' },
  { label: 'Ask Anything', desc: 'Your starting point', icon: 'CircleHelp', tone: 'bg-rose-50 text-rose-600' },
];

export const seedChats: ChatThread[] = [
  { id: '1', title: 'Ideas for my next project', time: 'Today, 10:42 AM', model: 'Smart AI' },
  { id: '2', title: 'Marketing plan for Dhaka cafe', time: 'Yesterday', model: 'Smart AI' },
  { id: '3', title: 'Explain quantum computing', time: 'Sep 7', model: 'Smart AI' },
  { id: '4', title: 'Bangla to English translation', time: 'Sep 5', model: 'Smart AI' },
  { id: '5', title: 'Recipe ideas for iftar', time: 'Sep 3', model: 'Smart AI' },
  { id: '6', title: 'Business plan for tea stall', time: 'Aug 28', model: 'Smart AI' },
];

export const seedAssets: Asset[] = [
  { id: 'file-1', kind: 'file', name: 'quarterly-report.pdf', size: '1.2 MB', uploaded: 'Sep 05, 2026', expires: 'Oct 05, 2026', days: 25 },
  { id: 'file-2', kind: 'file', name: 'brand-guidelines.png', size: '2.4 MB', uploaded: 'Aug 25, 2026', expires: 'Sep 24, 2026', days: 14 },
  { id: 'image-1', kind: 'image', name: 'Dhaka sunset concept', size: '3.8 MB', uploaded: 'Sep 01, 2026', expires: 'Oct 01, 2026', days: 21, prompt: 'A cinematic sunset over the Buriganga river' },
  { id: 'image-2', kind: 'image', name: 'Modern Bengal pattern', size: '2.6 MB', uploaded: 'Aug 12, 2026', expires: 'Sep 11, 2026', days: 1, prompt: 'A modern geometric Bengal textile pattern' },
];
