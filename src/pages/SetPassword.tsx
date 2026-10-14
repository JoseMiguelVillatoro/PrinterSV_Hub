import { useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/** Se muestra al entrar desde un enlace de invitación o recuperación. */
export function SetPasswordPage() {
  const { clearNeedsPassword, profile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState(profile?.full_name ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirm) return setError('Las contraseñas no coinciden.');
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.updateUser({ password });
    if (!error && data.user && name.trim()) {
      await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', data.user.id);
    }
    setLoading(false);
    if (error) return setError(error.message);
    window.history.replaceState(null, '', window.location.pathname);
    clearNeedsPassword();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-xl font-semibold text-navy-900">Definí tu contraseña</h2>
          <p className="mt-1 text-sm text-slate-500">Es la que vas a usar para entrar al Hub.</p>
        </div>
        <Field label="Tu nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirmar contraseña">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" loading={loading} className="w-full">
          Guardar y continuar
        </Button>
      </form>
    </div>
  );
}
