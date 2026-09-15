import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Command } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Sidebar, MobileMenuButton } from '@/components/Sidebar';
import { Dashboard } from '@/pages/Dashboard';
import { ChatPage } from '@/pages/ChatPage';
import { ImagesPage } from '@/pages/ImagesPage';
import { UsagePage } from '@/pages/UsagePage';
import { ExplorePage } from '@/pages/ExplorePage';
import { SubscriptionPage } from '@/pages/SubscriptionPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AdminPage } from '@/pages/AdminPage';
import { AuthPage } from '@/pages/AuthPage';
import { LegalPage } from '@/pages/LegalPage';
import type { View } from '@/lib/types';

function AppShell() {
  const { user, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      const publicPaths = ['/login', '/register', '/terms', '/privacy'];
      if (!publicPaths.includes(location.pathname)) {
        navigate('/login');
      }
    }
  }, [user, loading, location.pathname, navigate]);

  if (loading) return null;
  if (!user) {
    const publicPaths = ['/login', '/register', '/terms', '/privacy'];
    if (!publicPaths.includes(location.pathname)) return <Navigate to="/login" replace />;
  }

  const current: View = location.pathname.startsWith('/chat') ? 'chat'
    : location.pathname === '/images' ? 'images'
    : location.pathname === '/usage' ? 'usage'
    : location.pathname === '/explore' ? 'explore'
    : location.pathname === '/subscription' ? 'subscription'
    : location.pathname === '/settings' ? 'settings'
    : location.pathname === '/admin' ? 'admin'
    : 'dashboard';

  return (
    <div className="min-h-screen bg-[#f7f8fc] text-slate-900">
      <Sidebar current={current} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <main className="min-h-screen lg:pl-[280px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200/70 bg-[#f7f8fc]/90 px-5 backdrop-blur-xl lg:px-10">
          <MobileMenuButton onClick={() => setMobileOpen(true)} />
          <div className="hidden items-center gap-2 text-sm text-slate-500 lg:flex">
            <span className="font-semibold text-slate-800">Workspace</span>
            <span>/</span>
            <span className="capitalize">{current}</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm sm:flex sm:items-center sm:gap-2">
              <Command size={15} />⌘ K
            </button>
            <button className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm">
              <Bell size={18} />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-pink-500" />
            </button>
            <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-[#111827] text-sm font-bold text-white sm:flex">
              {user?.name?.[0] ?? 'U'}
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1420px] px-5 py-8 lg:px-10">
          {current === 'dashboard' && <Dashboard />}
          {current === 'chat' && <ChatPage />}
          {current === 'images' && <ImagesPage />}
          {current === 'usage' && <UsagePage />}
          {current === 'explore' && <ExplorePage />}
          {current === 'subscription' && <SubscriptionPage />}
          {current === 'settings' && <SettingsPage />}
          {current === 'admin' && <AdminPage />}
        </div>
      </main>
    </div>
  );
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/terms" element={<LegalPage title="Terms & Conditions" />} />
        <Route path="/privacy" element={<LegalPage title="Privacy Policy" />} />
        <Route path="/*" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
