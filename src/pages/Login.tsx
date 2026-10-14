import { useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input } from '@/components/ui';
import { supabase, supabaseConfigured } from '@/lib/supabase';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message);
  }

  async function onForgot() {
    if (!email.trim()) {
      setError('Escribí tu correo para enviarte el enlace de recuperación.');
      return;
    }
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (error) setError(error.message);
    else setInfo('Si el correo está registrado, Supabase enviará un enlace para restablecer la contraseña.');
  }

  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-1/2 overflow-hidden bg-navy-900 lg:block">
        <div className="absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-accent-500/20 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 font-bold text-white">P</div>
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-accent-400">Business Hub</span>
          </div>
          <div>
            <h1 className="max-w-md text-3xl font-semibold leading-tight text-white">
              Del primer contacto a la entrega, en un solo lugar.
            </h1>
            <p className="mt-4 max-w-md text-slate-300">
              Clientes, visitas, cotizaciones, pedidos, compras y entregas de Printer Computers &amp; Systems.
            </p>
          </div>
          <p className="text-xs text-slate-500">Uso interno · Acceso solo para usuarios autorizados</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-2xl font-semibold text-navy-900">Iniciar sesión</h2>
            <p className="mt-1 text-sm text-slate-500">Usá las credenciales que te asignó el administrador.</p>
          </div>
          {!supabaseConfigured && (
            <ErrorBox error="Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Revisá el archivo .env (ver README)." />
          )}
          <Field label="Correo">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Contraseña">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          {info && <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">{info}</div>}
          <Button type="submit" loading={loading} className="w-full">
            Entrar
          </Button>
          <button type="button" onClick={onForgot} className="w-full text-center text-sm text-brand-600 hover:underline">
            Olvidé mi contraseña
          </button>
        </form>
      </div>
    </div>
  );
}
