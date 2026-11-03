import { Fragment, useEffect, useState, type CSSProperties } from 'react';
import { wpRequest } from '@/lib/wp';
import { fetchRouting, saveRouting } from '@/lib/ai-api';

type Model = {
  id: string;
  model_id: string;
  display_name: string;
  provider: string;
  provider_label?: string;
  kind: 'chat' | 'image';
  auto_router_enabled?: boolean;
  fixed_credits?: number;
  next_fixed_credits?: number;
  next_credits_from?: string;
  web_search?: boolean;
  supports_image?: boolean;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
  image_cost_per_image: number;
  credit_multiplier: number;
  minimum_credits: number;
  max_output_tokens: number;
  is_active: boolean;
  manual_selection_enabled: boolean;
  sort_order: number;
};

type UserRow = { id: number; name: string; email: string; balance: number; used: number };

type Settings = {
  smart_ai_cost_tier: string;
  usd_to_bdt_rate: number;
  signup_enabled: number;
  signup_bonus: number;
  company_context: string;
  markup_pct: number;
};

const PROVIDERS: { value: string; label: string }[] = [
  { value: 'openai', label: 'ChatGPT Plus (OpenAI)' },
  { value: 'anthropic', label: 'Claude (Anthropic)' },
  { value: 'google', label: 'Gemini (Google)' },
  { value: 'x-ai', label: 'Grok (xAI)' },
  { value: 'moonshotai', label: 'Kimi (Moonshot)' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openrouter', label: 'Smart AI (OpenRouter)' },
];

const EMPTY: Model = {
  id: '', model_id: '', display_name: '', provider: 'openrouter', kind: 'chat', fixed_credits: 0, web_search: false,
  input_cost_per_mtok: 0, output_cost_per_mtok: 0, image_cost_per_image: 0,
  credit_multiplier: 2, minimum_credits: 1, max_output_tokens: 4096,
  is_active: true, manual_selection_enabled: true, sort_order: 0,
};

const page: CSSProperties = {
  fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a', background: '#f8fafc',
  minHeight: '100vh', padding: '28px', boxSizing: 'border-box',
};
const card: CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 20,
};
const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', height: 38, padding: '0 10px', borderRadius: 8,
  border: '1px solid #cbd5e1', fontSize: 14,
};
const button: CSSProperties = {
  height: 38, padding: '0 14px', borderRadius: 8, border: 0, background: '#0f766e',
  color: '#fff', fontWeight: 600, cursor: 'pointer',
};
const ghost: CSSProperties = { ...button, background: '#e2e8f0', color: '#0f172a' };

export function BDChatAdmin() {
  const [models, setModels] = useState<Model[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState<Model | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [routing, setRouting] = useState<Record<string, Record<string, string>>>({});
  const [routingEnv, setRoutingEnv] = useState<string>('smart');
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [grantUser, setGrantUser] = useState<UserRow | null>(null);
  const [grantAmount, setGrantAmount] = useState('');
  const [grantNote, setGrantNote] = useState('');
  const ENV_NAMES: Record<string, string> = {
    smart: 'Smart AI', openai: 'Smart GPT', anthropic: 'Smart Claude', google: 'Smart Gemini', 'x-ai': 'Smart Grok', deepseek: 'Smart DeepSeek',
  };

  const load = async () => {
    setError('');
    try {
      const [m, s] = await Promise.all([
        wpRequest<Model[]>('admin/models'),
        wpRequest<Settings>('admin/settings'),
      ]);
      setModels(m);
      setSettings(s);
      const rt = await fetchRouting();
      if (rt) {
        setRouting(Object.fromEntries(Object.entries(rt.envs).map(([env, rules]) => [
          env, Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, v.join(', ')])),
        ])));
      }
    } catch (e) {
      setError((e as Error).message || 'Could not load the admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const searchUsers = async () => {
    setError('');
    try {
      const q = userSearch.trim();
      setUsers(await wpRequest<UserRow[]>(`admin/users${q ? `?search=${encodeURIComponent(q)}` : ''}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const grantCredits = async () => {
    if (!grantUser) return;
    setError('');
    const amount = Number(grantAmount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
      setError('Enter a whole number of credits between 1 and 1,000,000.');
      return;
    }
    try {
      const res = await wpRequest<{ balance: number }>('admin/credits/grant', {
        method: 'POST', body: { userId: grantUser.id, amount, note: grantNote.trim() || 'Admin grant' },
      });
      setNotice(`Added ${amount} credits to ${grantUser.email}. New balance: ${res.balance}.`);
      setGrantUser({ ...grantUser, balance: res.balance });
      setUsers(users.map((u) => (u.id === grantUser.id ? { ...u, balance: res.balance } : u)));
      setGrantAmount('');
      setGrantNote('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveModel = async () => {
    if (!editing) return;
    setError('');
    try {
      const body = {
        ...editing,
        next_credits_from: editing.next_credits_from ? `${editing.next_credits_from.replace('T', ' ')}:00`.slice(0, 19) : null,
      };
      await wpRequest('admin/models', { method: 'POST', body });
      setEditing(null);
      setNotice('Model saved.');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeModel = async (m: Model) => {
    if (!window.confirm(`Delete ${m.display_name}?`)) return;
    try {
      await wpRequest(`admin/models/${m.id}`, { method: 'DELETE' });
      setNotice('Model deleted.');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveRoutingTable = async () => {
    setError('');
    try {
      const current = routing[routingEnv] ?? {};
      const body = Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v.split(',').map((x) => x.trim()).filter(Boolean)]));
      await saveRouting(routingEnv, body);
      setNotice(`${ENV_NAMES[routingEnv]} routing saved.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setError('');
    try {
      const s = await wpRequest<Settings>('admin/settings', { method: 'POST', body: settings });
      setSettings(s);
      setNotice('Settings saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const field = (label: string, key: keyof Model, type: 'text' | 'number' = 'text') => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
      {label}
      <input
        style={input}
        type={type}
        step="any"
        value={String(editing?.[key] ?? '')}
        onChange={(e) => setEditing((p) => p && {
          ...p,
          [key]: type === 'number' ? Number(e.target.value) : e.target.value,
        })}
      />
    </label>
  );

  return (
    <div style={page}>
      <h1 style={{ margin: '0 0 4px', fontSize: 24 }}>BD ChatGPT Admin</h1>
      <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 14 }}>
        Models, prices and sign-up settings. API keys stay in wp-config.php.
      </p>

      {error && <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>{error}</div>}
      {notice && !error && <div style={{ ...card, borderColor: '#99f6e4', background: '#f0fdfa', color: '#115e59' }}>{notice}</div>}
      {loading && <div style={card}>Loading...</div>}

      {!loading && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 16 }}>Models and prices</strong>
              <button style={button} onClick={() => setEditing({ ...EMPTY })}>Add model</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: 8 }}>Name</th>
                    <th style={{ padding: 8 }}>Model ID</th>
                    <th style={{ padding: 8 }}>Group</th>
                    <th style={{ padding: 8 }}>Credits / msg</th>
                    <th style={{ padding: 8 }}>In / 1M USD</th>
                    <th style={{ padding: 8 }}>Out / 1M USD</th>
                    <th style={{ padding: 8 }}>Used by Smart AI</th>
                    <th style={{ padding: 8 }}>Status</th>
                    <th style={{ padding: 8 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(models.reduce<Record<string, Model[]>>((acc, m) => {
                    const key = m.provider_label ?? m.provider;
                    (acc[key] = acc[key] ?? []).push(m);
                    return acc;
                  }, {})).map(([groupName, list]) => (
                    <Fragment key={groupName}>
                      <tr style={{ background: '#f8fafc' }}>
                        <td colSpan={9} style={{ padding: '10px 8px', fontWeight: 700, color: '#0f766e' }}>{groupName}</td>
                      </tr>
                      {list.map((m) => (
                        <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: 8, fontWeight: 600 }}>{m.display_name}{m.web_search ? ' 🌐' : ''}</td>
                          <td style={{ padding: 8 }}>{m.model_id}</td>
                          <td style={{ padding: 8 }}>{m.provider_label ?? m.provider}</td>
                          <td style={{ padding: 8 }}>
                            {m.fixed_credits ? m.fixed_credits : 'token price'}
                            {m.next_fixed_credits && m.next_credits_from ? (
                              <div style={{ fontSize: 12, color: '#b45309' }}>
                                → {m.next_fixed_credits} from {m.next_credits_from}
                              </div>
                            ) : null}
                          </td>
                          <td style={{ padding: 8 }}>{m.input_cost_per_mtok}</td>
                          <td style={{ padding: 8 }}>{m.output_cost_per_mtok}</td>
                          <td style={{ padding: 8 }}>{m.model_id === 'openrouter/auto' ? '—' : (m.auto_router_enabled ? 'Yes' : 'No')}</td>
                          <td style={{ padding: 8, color: m.is_active ? '#0f766e' : '#64748b' }}>{m.is_active ? 'Active' : 'Disabled'}</td>
                          <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                            {m.model_id !== 'openrouter/auto' && (
                              <>
                                <button style={{ ...ghost, height: 30, marginRight: 6 }} onClick={() => setEditing({ ...m, kind: m.supports_image ? 'image' : 'chat' })}>Edit</button>
                                <button style={{ ...ghost, height: 30, color: '#b91c1c' }} onClick={() => removeModel(m)}>Delete</button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {editing && (
            <div style={card}>
              <strong style={{ fontSize: 16 }}>{editing.id ? 'Edit model' : 'New model'}</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 14 }}>
                {field('Display name', 'display_name')}
                {field('Model ID (e.g. openai/gpt-4o-mini)', 'model_id')}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Group
                  <select style={input} value={editing.provider ?? 'openai'}
                    onChange={(e) => setEditing({ ...editing, provider: e.target.value })}>
                    {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </label>
                {field('Input price per 1M tokens (USD)', 'input_cost_per_mtok', 'number')}
                {field('Output price per 1M tokens (USD)', 'output_cost_per_mtok', 'number')}
                {field('Image price per image (USD)', 'image_cost_per_image', 'number')}
                {field('Credit multiplier', 'credit_multiplier', 'number')}
                {field('Minimum credits', 'minimum_credits', 'number')}
                {field('Max output tokens', 'max_output_tokens', 'number')}
                {field('Sort order', 'sort_order', 'number')}
                {field('Credits per message (0 = token price)', 'fixed_credits', 'number')}
                {field('Scheduled new credit price', 'next_fixed_credits', 'number')}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  New price starts on (site time)
                  <input style={input} type="datetime-local"
                    value={(editing.next_credits_from ?? '').replace(' ', 'T').slice(0, 16)}
                    onChange={(e) => setEditing({ ...editing, next_credits_from: e.target.value })} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 14, fontSize: 14 }}>
                <label><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Active</label>
                <label><input type="checkbox" checked={!!editing.web_search} onChange={(e) => setEditing({ ...editing, web_search: e.target.checked })} /> Web search</label>
                <label><input type="checkbox" checked={!!editing.auto_router_enabled} onChange={(e) => setEditing({ ...editing, auto_router_enabled: e.target.checked })} /> Smart AI can use it</label>
                <label><input type="checkbox" checked={editing.manual_selection_enabled} onChange={(e) => setEditing({ ...editing, manual_selection_enabled: e.target.checked })} /> Users can pick it</label>
                <label>Kind{' '}
                  <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as 'chat' | 'image' })}>
                    <option value="chat">Chat</option>
                    <option value="image">Image</option>
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button style={button} onClick={saveModel}>Save model</button>
                <button style={ghost} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div style={card}>
            <strong style={{ fontSize: 16 }}>Add credits to a user</strong>
            <p style={{ margin: '6px 0 12px', color: '#64748b', fontSize: 13 }}>
              Search by name or email, pick the user, then enter the credits to add. Credits added here show in their wallet right away.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input style={{ ...input, maxWidth: 320 }} placeholder="Name or email" value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') searchUsers(); }} />
              <button style={button} onClick={searchUsers}>Search</button>
            </div>
            {users.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: 8 }}>Name</th>
                    <th style={{ padding: 8 }}>Email</th>
                    <th style={{ padding: 8 }}>Balance</th>
                    <th style={{ padding: 8 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9', background: grantUser?.id === u.id ? '#f0fdfa' : undefined }}>
                      <td style={{ padding: 8 }}>{u.name}</td>
                      <td style={{ padding: 8 }}>{u.email}</td>
                      <td style={{ padding: 8 }}>{u.balance}</td>
                      <td style={{ padding: 8 }}>
                        <button style={{ ...ghost, height: 30 }} onClick={() => setGrantUser(u)}>Select</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {grantUser && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, alignItems: 'end' }}>
                <div style={{ fontSize: 14 }}>
                  <div style={{ fontWeight: 600 }}>{grantUser.name} ({grantUser.email})</div>
                  <div style={{ color: '#64748b' }}>Current balance: {grantUser.balance} credits</div>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Credits to add
                  <input style={input} type="number" min={1} max={1000000} value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Note (optional)
                  <input style={input} value={grantNote} onChange={(e) => setGrantNote(e.target.value)} />
                </label>
                <button style={button} onClick={grantCredits}>Add credits</button>
              </div>
            )}
          </div>

          <div style={card}>
            <strong style={{ fontSize: 16 }}>Routing rules</strong>
            <p style={{ margin: '6px 0 12px', color: '#64748b', fontSize: 13 }}>
              Pick an environment. Each message is sorted into one of these types, and the first model listed is tried first,
              then the next ones if it fails. Use model IDs from the table above, separated by commas.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
              Environment
              <select style={{ ...input, width: 240 }} value={routingEnv} onChange={(e) => setRoutingEnv(e.target.value)}>
                {Object.entries(ENV_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {Object.keys(routing[routingEnv] ?? {}).map((label) => (
              <label key={label} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10, alignItems: 'center', marginBottom: 8, fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>{label.replace('_', ' ')}</span>
                <input style={input} value={routing[routingEnv]?.[label] ?? ''}
                  onChange={(e) => setRouting({ ...routing, [routingEnv]: { ...(routing[routingEnv] ?? {}), [label]: e.target.value } })} />
              </label>
            ))}
            <button style={{ ...button, marginTop: 8 }} onClick={saveRoutingTable}>Save routing</button>
          </div>

          {settings && (
            <div style={card}>
              <strong style={{ fontSize: 16 }}>Settings</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 14 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  USD to BDT rate
                  <input style={input} type="number" value={settings.usd_to_bdt_rate}
                    onChange={(e) => setSettings({ ...settings, usd_to_bdt_rate: Number(e.target.value) })} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Welcome credits for new users
                  <input style={input} type="number" value={settings.signup_bonus}
                    onChange={(e) => setSettings({ ...settings, signup_bonus: Number(e.target.value) })} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Smart AI markup over real cost (%)
                  <input style={input} type="number" value={settings.markup_pct ?? 50}
                    onChange={(e) => setSettings({ ...settings, markup_pct: Number(e.target.value) })} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Smart AI cost tier
                  <select style={input} value={settings.smart_ai_cost_tier}
                    onChange={(e) => setSettings({ ...settings, smart_ai_cost_tier: e.target.value })}>
                    {['low', 'medium', 'high', 'xhigh', 'max'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                  <input type="checkbox" checked={!!settings.signup_enabled}
                    onChange={(e) => setSettings({ ...settings, signup_enabled: e.target.checked ? 1 : 0 })} />
                  Allow new sign-ups
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600, marginTop: 16 }}>
                Facts the AI must use (organisation, programmes, prices, dates, contacts)
                <textarea style={{ ...input, height: 180, padding: 10, fontWeight: 400 }} value={settings.company_context ?? ''}
                  onChange={(e) => setSettings({ ...settings, company_context: e.target.value })}
                  placeholder={'Write only facts that are true. Example:\nShaheen Education Family (SEF) is a Bangladesh-based education network.\nSpelling Star 2026 is its national English spelling competition.'} />
                <span style={{ fontWeight: 400, color: '#64748b' }}>The AI will not invent names, dates or numbers that are not written here. Max 6,000 characters.</span>
              </label>
              <button style={{ ...button, marginTop: 16 }} onClick={saveSettings}>Save settings</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
