import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(mode === 'login' ? 'demo@example.com' : '');
  const [password, setPassword] = useState(mode === 'login' ? 'password123' : '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = mode === 'login'
        ? await signIn(email, password)
        : await signUp(name, email, password);
      if (result.error) setError(result.error);
      else navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white">
      <div className="hidden w-[46%] flex-col justify-between overflow-hidden bg-[#111827] p-10 text-white lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-br from-indigo-500 to-pink-500"><Bot size={23} /></div>
            <span className="heading text-xl font-extrabold">BDChat</span>
          </div>
          <div className="mt-32 max-w-md">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-indigo-200"><Sparkles size={14} />Built for Bangladesh</div>
            <h1 className="heading text-5xl font-extrabold leading-[1.15]">Ideas move faster when you have the right assistant.</h1>
            <p className="mt-6 text-lg leading-8 text-slate-400">Chat, create, and get things done with a thoughtful AI workspace designed around how you work.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500"><ShieldCheck size={16} className="text-emerald-400" />Your files are private and expire after 30 days</div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-br from-indigo-500 to-pink-500 text-white"><Bot size={23} /></div>
              <span className="heading text-xl font-extrabold">BDChat</span>
            </div>
          </div>
          <div className="mb-8">
            <h2 className="heading text-3xl font-extrabold">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p className="mt-2 text-slate-500">{mode === 'login' ? 'Sign in to continue to your workspace.' : 'Start creating with BDChat for free.'}</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && <Field label="Full name" value={name} onChange={setName} placeholder="আহমেদ করিম" />}
            <Field label="Email address" value={email} onChange={setEmail} placeholder="you@example.com" type="email" />
            <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" type="password" />
            {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</div>}
            <button disabled={loading} className="w-full rounded-xl bg-[#111827] py-3.5 text-sm font-bold text-white transition hover:bg-indigo-600 disabled:opacity-60">
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign in to BDChat' : 'Create free account'}
            </button>
          </form>
          {mode === 'login' && (
            <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs leading-5 text-indigo-700">
              <strong>Demo access</strong><br />demo@example.com · password123
            </div>
          )}
          <div className="mt-8 text-center text-sm text-slate-500">
            {mode === 'login' ? 'New to BDChat?' : 'Already have an account?'}{' '}
            <button onClick={() => navigate(mode === 'login' ? '/register' : '/login')} className="font-bold text-indigo-600">
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </div>
          <p className="mt-8 text-center text-xs leading-5 text-slate-400">
            By continuing, you agree to our{' '}
            <button onClick={() => navigate('/terms')} className="underline">Terms</button> and{' '}
            <button onClick={() => navigate('/privacy')} className="underline">Privacy Policy</button>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <input required type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm outline-none transition placeholder:text-slate-300 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50" />
    </label>
  );
}
