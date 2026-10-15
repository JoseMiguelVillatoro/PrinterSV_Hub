import { useMutation } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button, Field, Input, Modal } from './ui';

/** "Mi cuenta": cada usuario puede cambiar su nombre y su contraseña. */
export function AccountModal({ open, onClose, onTour }: { open: boolean; onClose: () => void; onTour?: () => void }) {
  const { session, profile, refresh } = useAuth();
  const toast = useToast();
  const email = session?.user.email ?? '';
  const [name, setName] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  // Solo al abrir: si dependiera de `profile`, guardar el nombre borraría
  // lo que el usuario está escribiendo en los campos de contraseña.
  useEffect(() => {
    if (!open) return;
    setName(profile?.full_name ?? '');
    setCurrent('');
    setNext('');
    setConfirm('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const saveName = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Escribí tu nombre.');
      const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', session!.user.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await refresh();
      toast.success('Nombre actualizado');
    },
    onError: toast.error,
  });

  const savePassword = useMutation({
    mutationFn: async () => {
      if (!current) throw new Error('Escribí tu contraseña actual.');
      if (next.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
      if (next !== confirm) throw new Error('Las contraseñas nuevas no coinciden.');
      if (next === current) throw new Error('La nueva contraseña debe ser distinta a la actual.');
      // Verificar la contraseña actual antes de cambiarla
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) throw new Error('La contraseña actual no es correcta.');
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Contraseña cambiada. Usala la próxima vez que entres.');
      setCurrent('');
      setNext('');
      setConfirm('');
      onClose();
    },
    onError: toast.error,
  });

  return (
    <Modal open={open} onClose={onClose} title="Mi cuenta">
      <div className="space-y-6">
        <section className="space-y-3">
          <Field label="Correo">
            <Input value={email} disabled />
          </Field>
          <Field label="Nombre">
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              <Button variant="secondary" loading={saveName.isPending} onClick={() => saveName.mutate()}>
                Guardar
              </Button>
            </div>
          </Field>
        </section>

        <form
          className="space-y-3 border-t border-slate-100 pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            savePassword.mutate();
          }}
        >
          <h4 className="text-sm font-semibold text-navy-900">Cambiar contraseña</h4>
          <Field label="Contraseña actual">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirmar nueva contraseña">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" loading={savePassword.isPending} className="w-full">
            Cambiar contraseña
          </Button>
        </form>

        {onTour && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <p className="text-sm text-slate-600">¿Querés volver a ver el recorrido por el sistema?</p>
            <Button variant="secondary" icon={<Compass className="h-4 w-4" />} onClick={onTour}>
              Ver tour
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
