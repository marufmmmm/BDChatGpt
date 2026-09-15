import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Check, LogOut, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { PageTitle } from '@/pages/UsagePage';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { fetchProfileCredits } from '@/lib/ai-api';

export function SettingsPage() {
  const [tab, setTab] = useState('Account');
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [credits, setCredits] = useState<{ free: number; paid: number; used: number } | null>(null);

  useEffect(() => {
    fetchProfileCredits().then(setCredits);
  }, []);

  const saveName = async () => {
    setSaving(true);
    setSaved(false);
    if (supabase && user?.id && user.id !== 'demo') {
      await supabase.from('profiles').update({ full_name: name, updated_at: new Date().toISOString() }).eq('id', user.id);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleSignOut = () => {
    signOut();
    navigate('/login');
  };

  return (
    <div className="animate-in">
      <PageTitle title="Settings" desc="Manage your account, preferences, and privacy choices." />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
          {['Account', 'Preferences', 'Notifications', 'Privacy', 'Billing'].map(item => (
            <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-xl px-4 py-3 text-left text-sm font-bold ${tab === item ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white/70'}`}>
              {item}
            </button>
          ))}
        </div>
        <div className="space-y-5">
          {tab === 'Account' && (
            <>
              <div className="rounded-3xl border border-slate-200/80 bg-white p-6 card-shadow">
                <h2 className="heading text-lg font-extrabold">Profile</h2>
                <p className="mt-1 text-sm text-slate-500">Update your display name and view your account details.</p>
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-500">Display name</label>
                    <input value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-300" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-500">Email</label>
                    <input value={user?.email ?? ''} disabled className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-500">Plan</label>
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-600">{user?.plan ?? 'Free'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={saveName} disabled={saving || user?.id === 'demo'} className="flex items-center gap-2 rounded-xl bg-[#111827] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-600 disabled:opacity-50">
                      {saving ? 'Saving...' : 'Save changes'}
                    </button>
                    {saved && <span className="flex items-center gap-1 text-sm font-semibold text-emerald-600"><Check size={15} /> Saved</span>}
                    {user?.id === 'demo' && <span className="text-xs text-slate-400">Sign in to save changes</span>}
                  </div>
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200/80 bg-white p-6 card-shadow">
                <h2 className="heading text-lg font-extrabold">Credit balance</h2>
                <div className="mt-4 flex items-center gap-4">
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3">
                    <Zap size={16} className="text-amber-500" />
                    <span className="text-lg font-extrabold text-slate-800">{credits ? credits.free + credits.paid : '...'}</span>
                    <span className="text-xs text-slate-400">available</span>
                  </div>
                  <div className="text-sm text-slate-500">
                    {credits ? `${credits.used} used lifetime` : 'Loading...'}
                  </div>
                  <button onClick={() => navigate('/subscription')} className="ml-auto rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">
                    Buy credits
                  </button>
                </div>
              </div>
              <div className="rounded-3xl border border-red-100 bg-red-50/50 p-6">
                <h2 className="heading text-lg font-extrabold text-red-700">Sign out</h2>
                <p className="mt-1 text-sm text-slate-500">Sign out of your account on this device.</p>
                <button onClick={handleSignOut} className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-600 hover:bg-red-100">
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            </>
          )}

          {tab === 'Privacy' && (
            <>
              <div className="rounded-3xl border border-slate-200/80 bg-white p-6 card-shadow">
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><ShieldCheck size={19} /></div>
                  <div>
                    <h2 className="heading text-lg font-extrabold">Data retention policy</h2>
                    <p className="text-sm text-slate-500">You're always in control of your data.</p>
                  </div>
                </div>
                <div className="space-y-5">
                  <RetentionRow title="Uploaded files" desc="Stored for 30 days from upload, then automatically deleted." checked />
                  <RetentionRow title="Generated images" desc="Stored for 30 days from generation, then automatically deleted." checked />
                  <RetentionRow title="Chat history" desc="Stored indefinitely until you manually delete a conversation." />
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200/80 bg-white p-6 card-shadow">
                <h2 className="heading text-lg font-extrabold">Your data</h2>
                <p className="mt-2 text-sm text-slate-500">Download a copy of your data before it expires, or permanently remove your account.</p>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><ArrowDownToLine size={16} /> Download archive</button>
                  <button className="flex items-center justify-center gap-2 rounded-xl border border-red-100 px-4 py-3 text-sm font-bold text-red-600 hover:bg-red-50"><Trash2 size={16} /> Delete account</button>
                </div>
              </div>
            </>
          )}

          {tab === 'Billing' && (
            <div className="rounded-3xl border border-slate-200/80 bg-white p-6 card-shadow">
              <h2 className="heading text-lg font-extrabold">Billing</h2>
              <p className="mt-2 text-sm text-slate-500">Your current plan and credit balance.</p>
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                  <span className="text-sm font-bold text-slate-700">Current plan</span>
                  <span className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-bold text-indigo-600">{user?.plan ?? 'Free'}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                  <span className="text-sm font-bold text-slate-700">Available credits</span>
                  <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                    <Zap size={14} className="text-amber-500" />
                    {credits ? credits.free + credits.paid : '...'}
                  </span>
                </div>
                <button onClick={() => navigate('/subscription')} className="w-full rounded-xl bg-[#111827] py-3 text-sm font-bold text-white hover:bg-indigo-600">
                  Manage subscription
                </button>
              </div>
            </div>
          )}

          {(tab === 'Preferences' || tab === 'Notifications') && (
            <div className="rounded-3xl border border-slate-200/80 bg-white p-8 card-shadow">
              <h2 className="heading text-lg font-extrabold">{tab}</h2>
              <p className="mt-2 text-sm text-slate-500">Your {tab.toLowerCase()} preferences will appear here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RetentionRow({ title, desc, checked }: { title: string; desc: string; checked?: boolean }) {
  const [on, setOn] = useState(Boolean(checked));
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-5 last:border-0 last:pb-0">
      <div>
        <div className="font-bold text-slate-800">{title}</div>
        <p className="mt-1 text-sm leading-6 text-slate-500">{desc}</p>
      </div>
      {checked !== undefined && (
        <button onClick={() => setOn(!on)} className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-indigo-600' : 'bg-slate-200'}`}>
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${on ? 'left-6' : 'left-1'}`} />
        </button>
      )}
    </div>
  );
}
