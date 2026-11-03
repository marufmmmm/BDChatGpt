import { useEffect, useState, type ReactNode } from 'react';
import { wpRequest, logoutUrl, ApiError } from '@/lib/wp';
import { AuthContext, useAuth, type AuthContextType, type User } from '@/lib/auth-context';

type AccountResponse = { user: { id: number; name: string; email: string; isAdmin: boolean }; nonce?: string };

function toUser(u: AccountResponse['user']): User {
  return { id: String(u.id), name: u.name, email: u.email, plan: 'Free', isAdmin: u.isAdmin };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const me = await wpRequest<{ user: AccountResponse['user'] }>('me');
        setUser(toUser(me.user));
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn: AuthContextType['signIn'] = async (email, password) => {
    try {
      await wpRequest<AccountResponse>('auth/login', { body: { email, password } });
      // Reload so WordPress renders a fresh REST nonce; move off #/login first.
      window.location.hash = '#/';
      window.location.reload();
      return { error: null };
    } catch (err) {
      return { error: err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.' };
    }
  };

  const signUp: AuthContextType['signUp'] = async (name, email, password) => {
    try {
      await wpRequest<AccountResponse>('auth/register', { body: { name, email, password } });
      window.location.hash = '#/';
      window.location.reload();
      return { error: null };
    } catch (err) {
      return { error: err instanceof ApiError ? err.message : 'Sign-up failed. Please try again.' };
    }
  };

  const signOut = () => {
    wpRequest('auth/logout', { body: {} }).finally(() => {
      setUser(null);
      window.location.href = logoutUrl();
    });
  };

  // Kept for the existing screens; there is no demo account in the WordPress build.
  const signInDemo = () => {};

  const value: AuthContextType = { user, loading, signIn, signUp, signOut, signInDemo };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { useAuth };
