import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, DemoBadge, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { useSuppliers } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { supabase, unwrap } from '@/lib/supabase';
import type { Supplier } from '@/lib/types';

export function SuppliersPage() {
  const { data, isLoading, error } = useSuppliers();
  const [editing, setEditing] = useState<{ open: boolean; s: Supplier | null }>({ open: false, s: null });
  return (
    <>
      <PageHeader
        title="Proveedores"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ open: true, s: null })}>
            Nuevo proveedor
          </Button>
        }
      />
      <Card>
        <ErrorBox error={error} />
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState title="Sin proveedores" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Proveedor</Th>
                <Th className="hidden sm:table-cell">Contacto</Th>
                <Th>Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <p className="font-medium text-navy-900">
                      {s.name} <DemoBadge show={s.is_demo} />
                    </p>
                    {s.notes && <p className="text-xs text-slate-500">{s.notes}</p>}
                  </Td>
                  <Td className="hidden sm:table-cell">{[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || '—'}</Td>
                  <Td>
                    <Badge tone={s.is_active ? 'green' : 'slate'}>{s.is_active ? 'Activo' : 'Inactivo'}</Badge>
                  </Td>
                  <Td className="text-right">
                    <button className="text-sm text-brand-600 hover:underline" onClick={() => setEditing({ open: true, s })}>
                      Editar
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <SupplierModal open={editing.open} supplier={editing.s} onClose={() => setEditing({ open: false, s: null })} />
    </>
  );
}

function SupplierModal({ open, supplier, onClose }: { open: boolean; supplier: Supplier | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', contact_name: '', email: '', phone: '', notes: '', is_active: true });
  useEffect(() => {
    if (open)
      setForm({
        name: supplier?.name ?? '',
        contact_name: supplier?.contact_name ?? '',
        email: supplier?.email ?? '',
        phone: supplier?.phone ?? '',
        notes: supplier?.notes ?? '',
        is_active: supplier?.is_active ?? true,
      });
  }, [open, supplier]);
  const m = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('El nombre es obligatorio.');
      const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
      if (supplier) await unwrap(supabase.from('suppliers').update(payload).eq('id', supplier.id));
      else await unwrap(supabase.from('suppliers').insert(payload));
    },
    onSuccess: () => {
      toast.success('Proveedor guardado');
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? 'Editar proveedor' : 'Nuevo proveedor'}
      footer={
        <Button loading={m.isPending} onClick={() => m.mutate()}>
          Guardar
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Contacto">
          <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Correo" className="sm:col-span-2">
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Notas" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <Checkbox label="Activo" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
      </div>
    </Modal>
  );
}
