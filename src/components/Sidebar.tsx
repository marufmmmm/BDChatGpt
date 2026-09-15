import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Bot, CreditCard, ImageIcon, LayoutDashboard,
  Menu, MessageCircle, MoreHorizontal, Plus, Search, Settings, Shield, Trash2, X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { seedChats, type ChatThread } from '@/lib/types';

type View = 'dashboard' | 'chat' | 'images' | 'usage' | 'explore' | 'subscription' | 'settings' | 'admin';

export function Sidebar({
  current,
  mobileOpen,
  onClose,
}: {
  current: View;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [chats, setChats] = useState<ChatThread[]>(seedChats);
  const [search, setSearch] = useState('');
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('bdchat-threads');
    if (stored) {
      try {
        const parsed: ChatThread[] = JSON.parse(stored);
        if (parsed.length > 0) setChats(parsed);
      } catch { /* keep seed data */ }
    }
  }, []);

  const persist = (next: ChatThread[]) => {
    setChats(next);
    localStorage.setItem('bdchat-threads', JSON.stringify(next));
  };

  const newChat = () => {
    const id = String(Date.now());
    const thread: ChatThread = { id, title: 'New conversation', model: 'GPT-4 Mini', time: 'Just now' };
    persist([thread, ...chats]);
    navigate(`/chat/${id}`);
    onClose();
  };

  const deleteChat = (id: string) => {
    persist(chats.filter(c => c.id !== id));
    if (location.pathname === `/chat/${id}`) navigate('/');
  };

  const renameChat = (id: string, title: string) => {
    persist(chats.map(c => (c.id === id ? { ...c, title } : c)));
  };

  const filtered = chats.filter(c => c.title.toLowerCase().includes(search.toLowerCase()));

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, path: '/' },
    { id: 'images', label: 'Generated Images', icon: ImageIcon, path: '/images' },
    { id: 'usage', label: 'Usage & Storage', icon: BarChart3, path: '/usage' },
  ];
  const secondary = [
    { id: 'explore', label: 'Explore Models', icon: MessageCircle, path: '/explore' },
    { id: 'subscription', label: 'Subscription', icon: CreditCard, path: '/subscription' },
    { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
    { id: 'admin', label: 'Admin Panel', icon: Shield, path: '/admin' },
  ];

  const content = (
    <div className="flex h-full flex-col bg-[#111827] text-white">
      {/* Logo */}
      <div className="mb-5 flex items-center justify-between px-4 pt-4">
        <button className="flex items-center gap-3" onClick={() => { navigate('/'); onClose(); }}>
          <div className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-gradient-to-br from-indigo-500 to-pink-500 shadow-lg shadow-indigo-900/50">
            <Bot size={22} />
          </div>
          <div className="text-left">
            <div className="heading text-lg font-extrabold tracking-tight">BDChat</div>
            <div className="text-[10px] font-semibold uppercase tracking-[.22em] text-slate-400">Bangladesh AI</div>
          </div>
        </button>
        <button className="rounded-lg p-1 text-slate-400 hover:bg-white/10 lg:hidden" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      {/* New chat */}
      <div className="px-3">
        <button onClick={newChat} className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-black/10 transition hover:bg-indigo-50">
          <Plus size={17} /> New chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
          <Search size={15} className="text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Chat history list */}
      <div className="flex-1 overflow-y-auto scrollbar px-2 py-1">
        <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Chat history</div>
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-slate-500">No conversations found</div>
        )}
        {filtered.map(chat => (
          <div key={chat.id} className="group relative">
            <button
              onClick={() => { navigate(`/chat/${chat.id}`); onClose(); }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                location.pathname === `/chat/${chat.id}`
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <MessageCircle size={15} className="shrink-0 opacity-60" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{chat.title}</div>
                <div className="text-[10px] text-slate-500">{chat.time}</div>
              </div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === chat.id ? null : chat.id); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
            >
              <MoreHorizontal size={16} />
            </button>
            {activeMenu === chat.id && (
              <div className="absolute right-1 top-10 z-10 w-32 rounded-xl border border-white/10 bg-[#1f2545] py-1 shadow-xl">
                <button
                  onClick={() => {
                    const title = prompt('Rename chat', chat.title);
                    if (title) renameChat(chat.id, title);
                    setActiveMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5"
                >
                  <MessageCircle size={13} /> Rename
                </button>
                <button
                  onClick={() => { deleteChat(chat.id); setActiveMenu(null); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-red-400 hover:bg-white/5"
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Nav links */}
      <div className="border-t border-white/5 px-3 py-3">
        <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Workspace</div>
        <nav className="space-y-0.5">
          {navItems.map(item => (
            <NavButton key={item.id} {...item} active={current === item.id} onClick={() => { navigate(item.path); onClose(); }} />
          ))}
        </nav>
        <div className="mb-1 mt-3 px-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Discover</div>
        <nav className="space-y-0.5">
          {secondary.map(item => (
            <NavButton key={item.id} {...item} active={current === item.id} onClick={() => { navigate(item.path); onClose(); }} />
          ))}
        </nav>
      </div>

      {/* User card */}
      <div className="border-t border-white/5 p-3">
        <div className="mb-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">Storage</span>
            <span className="text-slate-400">45 / 100 MB</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[45%] rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400" />
          </div>
          <button onClick={() => { navigate('/subscription'); onClose(); }} className="mt-2 flex items-center gap-1 text-xs font-bold text-indigo-300 hover:text-white">
            Upgrade plan <ArrowRight size={12} />
          </button>
        </div>
        <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-pink-400 font-bold text-slate-900">
            {user?.name?.[0] ?? 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{user?.name ?? 'User'}</div>
            <div className="text-xs text-slate-400">{user?.plan ?? 'Free'} plan</div>
          </div>
          <MoreHorizontal size={17} className="text-slate-500" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className={`fixed inset-y-0 left-0 z-40 w-[280px] transform transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {content}
      </aside>
      {mobileOpen && (
        <button className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden" onClick={onClose} aria-label="Close menu" />
      )}
    </>
  );
}

function NavButton({ label, icon: Icon, active, onClick }: { label: string; icon: typeof LayoutDashboard; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
      <Icon size={17} className={active ? 'text-indigo-300' : ''} />
      {label}
    </button>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="rounded-xl p-2 text-slate-500 hover:bg-white lg:hidden" onClick={onClick}>
      <Menu size={21} />
    </button>
  );
}
