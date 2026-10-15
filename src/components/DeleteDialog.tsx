import { useMutation, useQuery } from '@tanstack/react-query';
import { Archive, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/toast';
import { supabase, unwrap } from '@/lib/supabase';
import { Button, Modal, Spinner } from './ui';

export type DeletableKind = 'client' | 'product' | 'supplier' | 'quote';

/**
 * Confirmación para eliminar. Antes de mostrar el botón, la base de datos dice si se puede
 * (y qué más se borra) o por qué no (y cómo archivarlo en su lugar).
 */
export function DeleteDialog({
  open,
  onClose,
  kind,
  id,
  name,
  onDeleted,
  archiveHint,
}: {
  open: boolean;
  onClose: () => void;
  kind: DeletableKind;
  id: string;
  name: string;
  onDeleted: () => void;
  /** Texto del botón para archivar en vez de eliminar, si aplica. */
  archiveHint?: { label: string; onArchive: () => void };
}) {
  const toast = useToast();
  const check = useQuery({
    queryKey: ['delete_check', kind, id],
    enabled: open,
    gcTime: 0,
    queryFn: () => unwrap(supabase.rpc('delete_check', { p_kind: kind, p_id: id })) as Promise<{ ok: boolean; reason?: string; detail?: string }>,
  });
  const del = useMutation({
    mutationFn: () => unwrap(supabase.rpc('delete_record', { p_kind: kind, p_id: id })),
    onSuccess: () => {
      toast.success(`"${name}" eliminado`);
      onClose();
      onDeleted();
    },
    onError: toast.error,
  });
  const ok = check.data?.ok;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ok === false ? 'No se puede eliminar' : `¿Eliminar "${name}"?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {ok === false ? 'Entendido' : 'Cancelar'}
          </Button>
          {ok === false && archiveHint && (
            <Button
              icon={<Archive className="h-4 w-4" />}
              onClick={() => {
                onClose();
                archiveHint.onArchive();
              }}
            >
              {archiveHint.label}
            </Button>
          )}
          {ok && (
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} loading={del.isPending} onClick={() => del.mutate()}>
              Eliminar
            </Button>
          )}
        </>
      }
    >
      {check.isLoading ? (
        <Spinner />
      ) : check.error ? (
        <p className="text-sm text-red-600">{String((check.error as Error).message)}</p>
      ) : ok ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p>Esta acción no se puede deshacer.</p>
          {check.data?.detail && <p>{check.data.detail}</p>}
          <p className="text-xs text-slate-500">Queda registrada en la Auditoría.</p>
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{check.data?.reason}</p>
      )}
    </Modal>
  );
}
