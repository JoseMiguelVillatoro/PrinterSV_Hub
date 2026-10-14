import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { AgendaPage } from './pages/Agenda';
import { ClientDetailPage } from './pages/ClientDetail';
import { ClientsPage } from './pages/Clients';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { OrderDetailPage } from './pages/OrderDetail';
import { OrdersPage } from './pages/Orders';
import { ProductsPage } from './pages/Products';
import { QuoteDetailPage } from './pages/QuoteDetail';
import { QuoteEditorPage } from './pages/QuoteEditor';
import { QuotesPage } from './pages/Quotes';
import { ReportsPage } from './pages/Reports';
import { SetPasswordPage } from './pages/SetPassword';
import { SettingsPage } from './pages/Settings';
import { SuppliersPage } from './pages/Suppliers';

function NoAccess() {
  const { signOut, session } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-navy-900">Tu usuario aún no tiene acceso</h1>
        <p className="mt-2 text-sm text-slate-500">
          Iniciaste sesión como <b>{session?.user.email}</b>, pero un administrador debe asignarte un rol (Comercial,
          Cotizaciones/Operaciones o Administrador) o tu usuario está desactivado.
        </p>
        <button onClick={() => void signOut()} className="mt-4 text-sm font-medium text-brand-600 hover:underline">
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

export function App() {
  const auth = useAuth();
  if (auth.loading) return <Spinner label="Iniciando…" />;
  if (!auth.session) return <LoginPage />;
  if (auth.needsPassword) return <SetPasswordPage />;
  if (!auth.isStaff) return <NoAccess />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="clientes/:id" element={<ClientDetailPage />} />
        <Route path="agenda" element={<AgendaPage />} />
        <Route path="cotizaciones" element={<QuotesPage />} />
        <Route path="cotizaciones/nueva" element={auth.canManageQuotes ? <QuoteEditorPage /> : <Navigate to="/cotizaciones" />} />
        <Route path="cotizaciones/:id" element={<QuoteDetailPage />} />
        <Route path="cotizaciones/:id/editar" element={auth.canManageQuotes ? <QuoteEditorPage /> : <Navigate to="/cotizaciones" />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="pedidos/:id" element={<OrderDetailPage />} />
        <Route path="productos" element={<ProductsPage />} />
        <Route path="proveedores" element={auth.canSeeCosts ? <SuppliersPage /> : <Navigate to="/" />} />
        <Route path="reportes" element={<ReportsPage />} />
        <Route path="configuracion" element={auth.isAdmin ? <SettingsPage /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
