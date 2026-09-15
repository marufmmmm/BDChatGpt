import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Check, CircleHelp, Clock3, FileText, FolderOpen,
  ImageIcon, MessageCircle, Plus, ShieldCheck, Sparkles, Zap,
} from 'lucide-react';
import { seedChats } from '@/lib/types';
import { fetchProfileCredits } from '@/lib/ai-api';
import { useAuth } from '@/lib/auth';

const quickActions = [
  { label: 'Chat with AI', desc: 'Ask anything', icon: MessageCircle, tone: 'bg-indigo-50 text-indigo-600', path: '/chat/new' },
  { label: 'Generate Image', desc: 'Bring ideas to life', icon: ImageIcon, tone: 'bg-pink-50 text-pink-600', path: '/images' },
  { label: 'Write Content', desc: 'Create faster', icon: FileText, tone: 'bg-amber-50 text-amber-600', path: '/chat/new' },
  { label: 'Analyze Document', desc: 'Get the key points', icon: BarChart3, tone: 'bg-emerald-50 text-emerald-600', path: '/chat/new' },
  { label: 'Brainstorm Ideas', desc: 'Think bigger', icon: Sparkles, tone: 'bg-cyan-50 text-cyan-600', path: '/chat/new' },
  { label: 'Translate', desc: 'Break language barriers', icon: ArrowRight, tone: 'bg-sky-50 text-sky-600', path: '/chat/new' },
  { label: 'Summarize', desc: 'Make it concise', icon: Clock3, tone: 'bg-orange-50 text-orange-600', path: '/chat/new' },
  { label: 'Ask Anything', desc: 'Your starting point', icon: CircleHelp, tone: 'bg-rose-50 text-rose-600', path: '/chat/new' },
];

export function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [credits, setCredits] = useState<{ free: number; paid: number; used: number } | null>(null);

  useEffect(() => {
    fetchProfileCredits().then(setCredits);
  }, []);

  const totalRemaining = credits ? credits.free + credits.paid : 0;
  const greetingName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <div className="animate-in">
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-indigo-600">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />Everything is ready
          </div>
          <h1 className="heading text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Hello, {greetingName}</h1>
          <p className="mt-2 text-slate-500">What would you like to create today?</p>
        </div>
        <button onClick={() => navigate('/chat/new')} className="flex w-fit items-center gap-2 rounded-xl bg-[#111827] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/15 transition hover:-translate-y-0.5 hover:bg-indigo-600">
          <Plus size={17} /> Start a new chat
        </button>
      </div>

      <div className="mb-8 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <StorageCard onNavigate={navigate} />
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-[#a855f7] p-6 text-white shadow-xl shadow-indigo-200">
          <div className="absolute -right-8 -top-12 h-40 w-40 rounded-full border-[20px] border-white/10" />
          <div className="absolute -bottom-16 -right-4 h-40 w-40 rounded-full border-[18px] border-pink-300/20" />
          <div className="relative">
            <div className="mb-10 flex items-center justify-between">
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">Credits</span>
              <Zap size={21} className="text-amber-300" />
            </div>
            <div className="heading text-3xl font-extrabold">{credits ? totalRemaining : '...'} credits</div>
            <p className="mt-1 max-w-[220px] text-sm leading-6 text-indigo-100">{credits ? `${credits.used} used lifetime` : 'Loading...'} · ৳1 = 1 credit</p>
            <button onClick={() => navigate('/subscription')} className="mt-5 flex items-center gap-2 text-sm font-bold text-white hover:text-amber-200">
              Buy credits <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="mb-9">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="heading text-lg font-extrabold">What can I help with?</h2>
            <p className="mt-1 text-sm text-slate-500">Jump into a workflow or start with a blank canvas.</p>
          </div>
          <button onClick={() => navigate('/explore')} className="hidden items-center gap-1 text-sm font-bold text-indigo-600 sm:flex">
            Explore all <ArrowRight size={15} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {quickActions.map(action => (
            <button
              key={action.label}
              onClick={() => navigate(action.path)}
              className="group rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg"
            >
              <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${action.tone}`}>
                <action.icon size={19} />
              </div>
              <div className="text-sm font-bold text-slate-800">{action.label}</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">{action.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <RecentChats onNavigate={navigate} />
    </div>
  );
}

function StorageCard({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-6 card-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <FolderOpen size={18} />
          </div>
          <div>
            <h2 className="font-bold text-slate-800">Your storage</h2>
            <p className="text-xs text-slate-400">Files and images are kept for 30 days</p>
          </div>
        </div>
        <button onClick={() => onNavigate('/usage')} className="text-sm font-bold text-indigo-600">Manage</button>
      </div>
      <div className="mt-7 flex items-end justify-between">
        <div>
          <span className="heading text-3xl font-extrabold">45</span>
          <span className="ml-1 text-sm font-semibold text-slate-400">MB used</span>
        </div>
        <span className="text-sm font-bold text-slate-600">of 100 MB</span>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full w-[45%] rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400" />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-slate-500">
        <span className="flex items-center gap-1.5"><Check size={14} className="text-emerald-500" /> 30-day auto-delete</span>
        <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-indigo-500" /> Private & secure</span>
      </div>
    </div>
  );
}

function RecentChats({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-6 card-shadow">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="heading text-lg font-extrabold">Recent conversations</h2>
          <p className="mt-1 text-sm text-slate-500">Pick up right where you left off.</p>
        </div>
        <button onClick={() => onNavigate('/chat/1')} className="text-sm font-bold text-indigo-600">View all</button>
      </div>
      <div className="divide-y divide-slate-100">
        {seedChats.slice(0, 3).map((chat, i) => (
          <button key={chat.id} onClick={() => onNavigate(`/chat/${chat.id}`)} className="group flex w-full items-center gap-4 py-4 text-left">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${i === 0 ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-500'}`}>
              <MessageCircle size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-slate-800 group-hover:text-indigo-600">{chat.title}</div>
              <div className="mt-1 text-xs text-slate-400">{chat.model} · {chat.time}</div>
            </div>
            <ArrowRight size={17} className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-500" />
          </button>
        ))}
      </div>
    </div>
  );
}
