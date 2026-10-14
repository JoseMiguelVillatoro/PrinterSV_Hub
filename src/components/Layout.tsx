import clsx from 'clsx';
import {
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  show?: (a: ReturnType<typeof useAuth>) => boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/clientes', label: 'Clientes', icon: <Users className="h-4 w-4" /> },
  { to: '/agenda', label: 'Agenda y tareas', icon: <CalendarDays className="h-4 w-4" /> },
  { to: '/cotizaciones', label: 'Cotizaciones', icon: <FileText className="h-4 w-4" /> },
  { to: '/pedidos', label: 'Pedidos y entregas', icon: <ClipboardList className="h-4 w-4" /> },
  { to: '/productos', label: 'Productos y servicios', icon: <Boxes className="h-4 w-4" /> },
  { to: '/proveedores', label: 'Proveedores', icon: <Truck className="h-4 w-4" />, show: (a) => a.canSeeCosts },
  { to: '/reportes', label: 'Reportes', icon: <BarChart3 className="h-4 w-4" /> },
  { to: '/configuracion', label: 'Configuración', icon: <Settings className="h-4 w-4" />, show: (a) => a.isAdmin },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 text-sm font-bold text-white shadow-lg shadow-brand-500/30">
        P
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-white">Printer</p>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-accent-400">Business Hub</p>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const auth = useAuth();
  return (
    <div className="flex h-full flex-col bg-navy-900">
      <Brand />
      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.filter((n) => !n.show || n.show(auth)).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-300 hover:bg-navy-800 hover:text-white',
              )
            }
          >
            {n.icon}
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-navy-800 p-4">
        <p className="truncate text-sm font-medium text-white">{auth.profile?.full_name || auth.session?.user.email}</p>
        <p className="truncate text-xs text-slate-400">{auth.roles.map((r) => ROLE_LABEL[r]).join(' · ') || 'Sin rol asignado'}</p>
        <button
          onClick={() => void auth.signOut()}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-navy-800 hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-5 z-10 text-slate-300" aria-label="Cerrar menú">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold text-navy-900">{current?.label ?? 'Printer Business Hub'}</span>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
