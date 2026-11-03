import { useEffect, useState } from 'react';
import { Sparkles, Zap } from 'lucide-react';
import { tierLabels, tierColors, type AIModel } from '@/lib/types';
import { fetchModels } from '@/lib/ai-api';

export function ExplorePage() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchModels().then(m => { setModels(m); setLoading(false); });
  }, []);

  const chatModels = models.filter(m => m.supports_chat && m.manual_selection_enabled);

  return (
    <div className="animate-in">
      <div className="mb-8">
        <h1 className="heading text-3xl font-extrabold">Explore models</h1>
        <p className="mt-2 text-slate-500">Choose the right intelligence for every kind of work.</p>
      </div>

      <div className="mb-6 flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-800">
        <Sparkles size={18} className="text-indigo-600" />
        <span><strong>Smart AI</strong> picks the best model automatically. Or pick any model manually from the chat.</span>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-400">Loading models...</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {chatModels.map(model => (
            <div key={model.id} className="rounded-3xl border border-slate-200/80 bg-white p-6 transition hover:shadow-lg">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#111827] text-sm font-extrabold text-white">
                    {model.display_name.slice(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-800">{model.display_name}</h3>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${tierColors[model.tier]}15`, color: tierColors[model.tier] }}>
                        {tierLabels[model.tier]}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {model.supports_reasoning && <CapabilityBadge label="Reasoning" />}
                      {model.supports_coding && <CapabilityBadge label="Coding" />}
                      {model.supports_web && <CapabilityBadge label="Web" />}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-xs font-bold text-slate-600">
                    <Zap size={11} className="text-amber-500" />
                    {model.minimum_credits}+
                  </div>
                  <div className="text-[10px] text-slate-400">credits/msg</div>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
                <span>Max context: {model.max_context.toLocaleString()} tokens</span>
                {model.manual_selection_enabled && (
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600">Available</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CapabilityBadge({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{label}</span>
  );
}
