import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AppRole, Profile } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  /** El usuario viene de un enlace de invitación/recuperación y debe definir contraseña. */
  needsPassword: boolean;
  clearNeedsPassword: () => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  // Permisos de UI. El backend (RLS) los vuelve a validar siempre.
  isStaff: boolean;
  isAdmin: boolean;
  canManageQuotes: boolean; // crear/editar cotizaciones, productos, pedidos
  canSeeCosts: boolean; // costos, márgenes, compras
  canManageVisits: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

function detectInviteFlow(): boolean {
  const hash = window.location.hash;
  return /type=(invite|recovery|signup)/.test(hash);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(detectInviteFlow());

  const loadUser = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setRoles([]);
      return;
    }
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.rpc('my_roles'),
    ]);
    setProfile((p as Profile) ?? null);
    setRoles(((r as AppRole[] | null) ?? []).filter(Boolean));
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadUser(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true);
      // Evitar llamadas a Supabase dentro del callback (recomendación de supabase-js)
      setTimeout(() => {
        void loadUser(s);
      }, 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadUser]);

  const value = useMemo<AuthState>(() => {
    const has = (r: AppRole) => roles.includes(r);
    const active = profile?.is_active !== false;
    return {
      loading,
      session,
      profile,
      roles,
      needsPassword,
      clearNeedsPassword: () => setNeedsPassword(false),
      refresh: () => loadUser(session),
      signOut: async () => {
        await supabase.auth.signOut();
      },
      isStaff: active && roles.length > 0,
      isAdmin: active && has('admin'),
      canManageQuotes: active && (has('admin') || has('operaciones')),
      canSeeCosts: active && (has('admin') || has('operaciones')),
      canManageVisits: active && (has('admin') || has('comercial')),
    };
  }, [loading, session, profile, roles, needsPassword, loadUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
