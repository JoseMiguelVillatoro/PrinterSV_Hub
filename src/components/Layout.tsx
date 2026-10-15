import clsx from 'clsx';
import {
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/format';
import { AccountModal } from './AccountModal';
import { GlobalSearch } from './GlobalSearch';
import { Tour, tourDone } from './Tour';

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: ReactNode;
  show?: (a: ReturnType<typeof useAuth>) => boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', short: 'Inicio', icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
  { to: '/clientes', label: 'Clientes', icon: <Users className="h-[18px] w-[18px]" /> },
  { to: '/agenda', label: 'Agenda y visitas', short: 'Agenda', icon: <CalendarDays className="h-[18px] w-[18px]" /> },
  { to: '/cotizaciones', label: 'Cotizaciones', short: 'Cotizar', icon: <FileText className="h-[18px] w-[18px]" /> },
  { to: '/pedidos', label: 'Pedidos y compras', short: 'Pedidos', icon: <ClipboardList className="h-[18px] w-[18px]" /> },
  { to: '/productos', label: 'Productos y servicios', icon: <Boxes className="h-[18px] w-[18px]" /> },
  { to: '/proveedores', label: 'Proveedores', icon: <Truck className="h-[18px] w-[18px]" />, show: (a) => a.canSeeCosts },
  { to: '/reportes', label: 'Reportes', icon: <BarChart3 className="h-[18px] w-[18px]" /> },
  { to: '/configuracion', label: 'Configuración', icon: <Settings className="h-[18px] w-[18px]" />, show: (a) => a.isAdmin },
];

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··';
}

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <img src="/logo.png" alt="Printer Computers & Systems" className={compact ? 'h-8 w-8 object-contain' : 'h-11 w-11 object-contain drop-shadow'} />
      <div className="leading-none">
        <p className={clsx('font-bold tracking-tight', compact ? 'text-base text-navy-900' : 'text-2xl text-white')}>Printer</p>
        <p className={clsx('mt-0.5 font-medium', compact ? 'text-[10px] text-slate-500' : 'text-[11px] text-slate-300')}>Computers &amp; Systems</p>
      </div>
    </Link>
  );
}

function Sidebar({ onNavigate, onAccount }: { onNavigate?: () => void; onAccount: () => void }) {
  const auth = useAuth();
  return (
    <div className="flex h-full flex-col bg-navy-900">
      <div className="px-5 pb-6 pt-6">
        <Brand />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.filter((n) => !n.show || n.show(auth)).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            data-tour={n.to}
            end={n.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/25' : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )
            }
          >
            {n.icon}
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 rounded-xl bg-white/5 p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-sm font-semibold text-white">
            {initials(auth.profile?.full_name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{auth.profile?.full_name || auth.session?.user.email}</p>
            <p className="truncate text-xs text-slate-400">{auth.roles.map((r) => ROLE_LABEL[r]).join(' · ')}</p>
          </div>
        </div>
        <button
          data-tour="account"
          onClick={() => {
            onNavigate?.();
            onAccount();
          }}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
        >
          <KeyRound className="h-4 w-4" /> Mi cuenta
        </button>
        <button
          onClick={() => void auth.signOut()}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}

const MOBILE_TABS = ['/', '/clientes', '/cotizaciones', '/pedidos'];

export function Layout() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const [tour, setTour] = useState(false);

  // Primera vez que entra: mostrar el tour. Solo depende del usuario, así que
  // no se repite al recargar datos; al terminarlo se guarda en su cuenta.
  const userId = auth.session?.user.id;
  useEffect(() => {
    if (!userId || tourDone(auth)) return;
    const t = setTimeout(() => setTour(true), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to));

  return (
    <div className="min-h-screen bg-slate-100/70">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar onAccount={() => setAccount(true)} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-7 z-10 text-slate-300" aria-label="Cerrar menú">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} onAccount={() => setAccount(true)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Barra superior */}
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden">
              <Brand compact />
            </div>
            <div className="hidden flex-1 md:block" data-tour="search">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {auth.canManageQuotes && (
                <button
                  data-tour="new-quote"
                  onClick={() => navigate('/cotizaciones/nueva')}
                  className="hidden h-9 items-center gap-2 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white shadow-sm hover:bg-brand-600 sm:inline-flex"
                >
                  <Plus className="h-4 w-4" /> Nueva cotización
                </button>
              )}
              <button
                onClick={() => setAccount(true)}
                title="Mi cuenta"
                className="hidden h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-sm font-semibold text-white hover:opacity-90 lg:flex"
              >
                {initials(auth.profile?.full_name)}
              </button>
              <button onClick={() => setOpen(true)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Abrir menú">
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="px-4 pb-3 md:hidden" data-tour="search">
            <GlobalSearch />
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <Outlet />
        </main>
      </div>

      <AccountModal
        open={account}
        onClose={() => setAccount(false)}
        onTour={() => {
          setAccount(false);
          setOpen(false);
          setTour(true);
        }}
      />
      <Tour open={tour} onClose={() => setTour(false)} />

      {/* Navegación inferior en móvil */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.filter((n) => MOBILE_TABS.includes(n.to)).map((n) => (
          <Link key={n.to} to={n.to} data-tour={n.to} className={clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive(n.to) ? 'text-brand-600' : 'text-slate-500')}>
            {n.icon}
            {n.short ?? n.label}
          </Link>
        ))}
        <button onClick={() => setOpen(true)} data-tour="account" className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500">
          <Menu className="h-[18px] w-[18px]" />
          Más
        </button>
      </nav>
    </div>
  );
}
