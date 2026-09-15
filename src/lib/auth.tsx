import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { AuthContext, useAuth, type AuthContextType, type User } from '@/lib/auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub: (() => void) | null = null;

    (async () => {
      if (supabase) {
        const sb = supabase;
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user) {
          const fullName = (session.user.user_metadata?.full_name as string) || 'BDChat User';
          const { data: profile } = await sb
            .from('profiles')
            .select('plan')
            .eq('id', session.user.id)
            .maybeSingle();
          setUser({
            id: session.user.id,
            name: fullName,
            email: session.user.email ?? '',
            plan: (profile?.plan as string) || 'Free',
          });
        } else {
          const demoSession = localStorage.getItem('bdchat-demo-session');
          if (demoSession === 'true') {
            setUser({ id: 'demo', name: 'আহমেদ করিম', email: 'demo@example.com', plan: 'Free' });
          }
        }

        const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
          (async () => {
            if (session?.user) {
              const fullName = (session.user.user_metadata?.full_name as string) || 'BDChat User';
              const { data: profile } = await sb
                .from('profiles')
                .select('plan')
                .eq('id', session.user.id)
                .maybeSingle();
              setUser({
                id: session.user.id,
                name: fullName,
                email: session.user.email ?? '',
                plan: (profile?.plan as string) || 'Free',
              });
              localStorage.setItem('bdchat-demo-session', 'true');
            }
          })();
        });
        unsub = sub.subscription.unsubscribe;
      } else {
        const demoSession = localStorage.getItem('bdchat-demo-session');
        if (demoSession === 'true') {
          setUser({ id: 'demo', name: 'আহমেদ করিম', email: 'demo@example.com', plan: 'Free' });
        }
      }
      setLoading(false);
    })();

    return () => { unsub?.(); };
  }, []);

  const signIn = async (email: string, password: string) => {
    if (email === 'demo@example.com' && password === 'password123') {
      signInDemo();
      return { error: null };
    }
    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      return { error: null };
    }
    return { error: 'Please use the demo account to preview BDChat.' };
  };

  const signUp = async (name: string, email: string, password: string) => {
    if (supabase) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (error) return { error: error.message };
      if (data.user) {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          full_name: name,
          email,
          plan: 'Free',
          free_credits: 100,
          paid_credits: 0,
        });
      }
      return { error: null };
    }
    signInDemo();
    return { error: null };
  };

  const signOut = () => {
    localStorage.removeItem('bdchat-demo-session');
    setUser(null);
    if (supabase) supabase.auth.signOut();
  };

  const signInDemo = () => {
    localStorage.setItem('bdchat-demo-session', 'true');
    setUser({ id: 'demo', name: 'আহমেদ করিম', email: 'demo@example.com', plan: 'Free' });
  };

  const value: AuthContextType = { user, loading, signIn, signUp, signOut, signInDemo };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { useAuth };
