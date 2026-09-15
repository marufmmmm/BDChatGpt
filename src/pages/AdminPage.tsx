import { useEffect, useState } from 'react';
import {
  Check, Edit3, Plus, Save, Shield, Trash2, X, Zap,
} from 'lucide-react';
import {
  fetchAllModels, saveModelAdmin, deleteModelAdmin,
} from '@/lib/ai-api';
import {
  providerLabels, tierLabels, tierColors,
  type AIModel, type AIProvider, type ModelTier,
} from '@/lib/types';

type EditState = Partial<AIModel> & { isNew?: boolean };

export function AdminPage() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState | null>(null);

  const load = async () => {
    const data = await fetchAllModels();
    setModels(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveModel = async (model: EditState) => {
    const result = await saveModelAdmin({
      ...model,
      fallback_priority: model.fallback_priority ?? 99,
      supports_chat: model.supports_chat ?? true,
      supports_image: model.supports_image ?? false,
      supports_reasoning: model.supports_reasoning ?? false,
      supports_web: model.supports_web ?? false,
      supports_coding: model.supports_coding ?? false,
      max_context: model.max_context ?? 4096,
    });
    if (!result.success) { alert('Error saving: ' + (result.error ?? 'Unknown error')); return; }
    setEditing(null);
    load();
  };

  const deleteModel = async (id: string) => {
    if (!confirm('Delete this model? This cannot be undone.')) return;
    const result = await deleteModelAdmin(id);
    if (!result.success) { alert('Error deleting: ' + (result.error ?? 'Unknown error')); return; }
    load();
  };

  const toggleActive = async (model: AIModel) => {
    const result = await saveModelAdmin({ ...model, is_active: !model.is_active });
    if (!result.success) { alert('Error: ' + (result.error ?? 'Unknown error')); return; }
    load();
  };

  const toggleAutoRouter = async (model: AIModel) => {
    const result = await saveModelAdmin({ ...model, auto_router_enabled: !model.auto_router_enabled });
    if (!result.success) return;
    load();
  };

  const toggleManual = async (model: AIModel) => {
    const result = await saveModelAdmin({ ...model, manual_selection_enabled: !model.manual_selection_enabled });
    if (!result.success) return;
    load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Loading models...</div>;
  }

  return (
    <div className="animate-in">
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-indigo-600">
            <Shield size={15} />Admin panel
          </div>
          <h1 className="heading text-3xl font-extrabold">AI Model Management</h1>
          <p className="mt-2 text-slate-500">Configure providers, pricing, and auto-router settings. Changes take effect immediately.</p>
        </div>
        <button
          onClick={() => setEditing({ isNew: true, provider: 'openai', tier: 'economy', credit_multiplier: 2.0, minimum_credits: 1, max_output_tokens: 4096, is_active: true, auto_router_enabled: true, manual_selection_enabled: true, auto_router_priority: 99, profit_margin_target: 0.50, usd_to_bdt_rate: 127, sort_order: models.length, input_cost_per_mtok: 0, output_cost_per_mtok: 0, image_cost_per_image: 0 })}
          className="flex w-fit items-center gap-2 rounded-xl bg-[#111827] px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-600"
        >
          <Plus size={17} /> Add model
        </button>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Total models" value={String(models.length)} />
        <StatCard label="Active" value={String(models.filter(m => m.is_active).length)} />
        <StatCard label="Auto-router" value={String(models.filter(m => m.auto_router_enabled).length)} />
        <StatCard label="Providers" value={String(new Set(models.map(m => m.provider)).size)} />
      </div>

      {/* Model table */}
      <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white card-shadow">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-4">Model</th>
                <th className="px-5 py-4">Provider</th>
                <th className="px-5 py-4">Tier</th>
                <th className="px-5 py-4">Min credits</th>
                <th className="px-5 py-4">Auto</th>
                <th className="px-5 py-4">Manual</th>
                <th className="px-5 py-4">Priority</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {models.map(m => (
                <tr key={m.id} className="text-sm transition hover:bg-slate-50/50">
                  <td className="px-5 py-4">
                    <div className="font-bold text-slate-800">{m.display_name}</div>
                    <div className="text-xs text-slate-400">{m.model_id}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                      {providerLabels[m.provider]}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ backgroundColor: `${tierColors[m.tier]}15`, color: tierColors[m.tier] }}>
                      {tierLabels[m.tier]}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="flex items-center gap-1 font-bold text-slate-700">
                      <Zap size={11} className="text-amber-500" />{m.minimum_credits}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => toggleAutoRouter(m)}><Toggle checked={m.auto_router_enabled} /></button>
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => toggleManual(m)}><Toggle checked={m.manual_selection_enabled} /></button>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{m.auto_router_priority}</td>
                  <td className="px-5 py-4">
                    <button onClick={() => toggleActive(m)} className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${m.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      {m.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditing(m)} className="rounded-lg p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                        <Edit3 size={15} />
                      </button>
                      <button onClick={() => deleteModel(m.id)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditModelModal model={editing} onClose={() => setEditing(null)} onSave={saveModel} />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 card-shadow">
      <div className="text-xs font-semibold text-slate-400">{label}</div>
      <div className="heading mt-1 text-2xl font-extrabold text-slate-800">{value}</div>
    </div>
  );
}

function Toggle({ checked }: { checked: boolean }) {
  return (
    <div className={`relative h-5 w-9 rounded-full ${checked ? 'bg-emerald-400' : 'bg-slate-200'}`}>
      <span className={`absolute top-1 h-3 w-3 rounded-full bg-white shadow transition ${checked ? 'left-5' : 'left-1'}`} />
    </div>
  );
}

function EditModelModal({ model, onClose, onSave }: { model: EditState; onClose: () => void; onSave: (m: EditState) => void }) {
  const [form, setForm] = useState<EditState>(model);
  const set = <K extends keyof EditState>(key: K, value: EditState[K]) => setForm(f => ({ ...f, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl animate-in">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="heading text-lg font-extrabold">{model.isNew ? 'Add model' : `Edit ${model.display_name}`}</h2>
            <p className="text-sm text-slate-500">Configure provider, pricing, and routing settings.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <select value={form.provider} onChange={e => set('provider', e.target.value as AIProvider)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300">
              {Object.entries(providerLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <Field label="Model ID (API name)">
            <input value={form.model_id ?? ''} onChange={e => set('model_id', e.target.value)} placeholder="gpt-4o-mini" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Display name">
            <input value={form.display_name ?? ''} onChange={e => set('display_name', e.target.value)} placeholder="GPT-4o Mini" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Tier">
            <select value={form.tier} onChange={e => set('tier', e.target.value as ModelTier)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300">
              {Object.entries(tierLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <Field label="Input cost / M tokens (USD)">
            <input type="number" step="0.001" value={form.input_cost_per_mtok ?? 0} onChange={e => set('input_cost_per_mtok', parseFloat(e.target.value) || 0)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Output cost / M tokens (USD)">
            <input type="number" step="0.001" value={form.output_cost_per_mtok ?? 0} onChange={e => set('output_cost_per_mtok', parseFloat(e.target.value) || 0)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Image cost / image (USD)">
            <input type="number" step="0.001" value={form.image_cost_per_image ?? 0} onChange={e => set('image_cost_per_image', parseFloat(e.target.value) || 0)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Credit multiplier">
            <input type="number" step="0.1" value={form.credit_multiplier ?? 2.0} onChange={e => set('credit_multiplier', parseFloat(e.target.value) || 1)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Minimum credits">
            <input type="number" value={form.minimum_credits ?? 1} onChange={e => set('minimum_credits', parseInt(e.target.value) || 1)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Max output tokens">
            <input type="number" value={form.max_output_tokens ?? 4096} onChange={e => set('max_output_tokens', parseInt(e.target.value) || 4096)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Auto-router priority (1=highest)">
            <input type="number" value={form.auto_router_priority ?? 99} onChange={e => set('auto_router_priority', parseInt(e.target.value) || 99)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Profit margin target">
            <input type="number" step="0.05" value={form.profit_margin_target ?? 0.50} onChange={e => set('profit_margin_target', parseFloat(e.target.value) || 0)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="USD to BDT rate">
            <input type="number" value={form.usd_to_bdt_rate ?? 127} onChange={e => set('usd_to_bdt_rate', parseFloat(e.target.value) || 127)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Sort order">
            <input type="number" value={form.sort_order ?? 0} onChange={e => set('sort_order', parseInt(e.target.value) || 0)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Max context (tokens)">
            <input type="number" value={form.max_context ?? 4096} onChange={e => set('max_context', parseInt(e.target.value) || 4096)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
          <Field label="Fallback priority (1=highest)">
            <input type="number" value={form.fallback_priority ?? 99} onChange={e => set('fallback_priority', parseInt(e.target.value) || 99)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
          </Field>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <CheckboxField label="Active" checked={form.is_active ?? true} onChange={v => set('is_active', v)} />
          <CheckboxField label="Auto-router enabled" checked={form.auto_router_enabled ?? true} onChange={v => set('auto_router_enabled', v)} />
          <CheckboxField label="Manual selection" checked={form.manual_selection_enabled ?? true} onChange={v => set('manual_selection_enabled', v)} />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          <CheckboxField label="Chat" checked={form.supports_chat ?? true} onChange={v => set('supports_chat', v)} />
          <CheckboxField label="Image" checked={form.supports_image ?? false} onChange={v => set('supports_image', v)} />
          <CheckboxField label="Reasoning" checked={form.supports_reasoning ?? false} onChange={v => set('supports_reasoning', v)} />
          <CheckboxField label="Web" checked={form.supports_web ?? false} onChange={v => set('supports_web', v)} />
          <CheckboxField label="Coding" checked={form.supports_coding ?? false} onChange={v => set('supports_coding', v)} />
        </div>

        <Field label="Admin notes">
          <textarea value={form.admin_notes ?? ''} onChange={e => set('admin_notes', e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-300" />
        </Field>

        <div className="mt-6 flex gap-3">
          <button onClick={() => onSave(form)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#111827] py-3.5 text-sm font-bold text-white transition hover:bg-indigo-600">
            <Save size={16} /> Save model
          </button>
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-6 py-3.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-500">{label}</label>
      {children}
    </div>
  );
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className={`flex items-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-bold transition ${checked ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>
      <div className={`flex h-5 w-5 items-center justify-center rounded-md ${checked ? 'bg-emerald-500 text-white' : 'bg-slate-200'}`}>
        {checked && <Check size={13} />}
      </div>
      {label}
    </button>
  );
}
