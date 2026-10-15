// Formularios modales compartidos: cliente, contacto, visita y tarea.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, useState } from 'react';
import { useClientOptions, useContacts, useProfiles } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import {
  CLIENT_STATUS_LABEL,
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  VISIT_STATUS_LABEL,
  addDaysISO,
  fromLocalInput,
  toLocalInput,
  todayISO,
} from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { Client, ClientStatus, Contact, Task, TaskPriority, TaskStatus, Visit, VisitStatus } from '@/lib/types';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from './ui';

const LocationPicker = lazy(() => import('./ClientMap').then((m) => ({ default: m.LocationPicker })));

/** Convierte '' en null para columnas opcionales. */
function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
  return out as T;
}

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
}

function OwnerSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data: profiles } = useProfiles();
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Sin asignar</option>
      {profiles?.filter((p) => p.is_active).map((p) => (
        <option key={p.id} value={p.id}>
          {p.full_name || p.email}
        </option>
      ))}
    </Select>
  );
}

// ---------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------
type ClientDraft = Omit<Client, 'id' | 'is_demo' | 'created_at'>;
const emptyClient = (owner: string | null): ClientDraft => ({
  name: '',
  legal_name: '',
  tax_id: '',
  industry: '',
  status: 'prospecto',
  source: '',
  address: '',
  city: '',
  department: '',
  phone: '',
  email: '',
  website: '',
  needs: '',
  notes: '',
  latitude: null,
  longitude: null,
  owner_id: owner,
});

export function ClientFormModal({
  open,
  onClose,
  client,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  client?: Client | null;
  onSaved?: (id: string) => void;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [form, setForm] = useState<ClientDraft>(emptyClient(session?.user.id ?? null));

  useEffect(() => {
    if (!open) return;
    if (client) {
      const { id: _id, is_demo: _d, created_at: _c, ...rest } = client;
      setForm(rest);
    } else setForm(emptyClient(session?.user.id ?? null));
  }, [open, client, session]);

  const set = <K extends keyof ClientDraft>(k: K, v: ClientDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('El nombre es obligatorio.');
      const payload: Partial<ClientDraft> = clean(form);
      // Solo se mandan las coordenadas si hay ubicación (o había y se quitó):
      // así guardar un cliente funciona aunque la columna aún no exista en la base.
      if (form.latitude == null && form.longitude == null && client?.latitude == null) {
        delete payload.latitude;
        delete payload.longitude;
      }
      if (client) {
        await unwrap(supabase.from('clients').update(payload).eq('id', client.id));
        return client.id;
      }
      const row = await unwrap(supabase.from('clients').insert(payload).select('id').single());
      return (row as { id: string }).id;
    },
    onSuccess: (id) => {
      toast.success(client ? 'Cliente actualizado' : 'Cliente creado');
      invalidate('clients', 'client', 'dashboard');
      onSaved?.(id);
      onClose();
    },
    onError: toast.error,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={client ? 'Editar cliente' : 'Nuevo cliente'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre comercial" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Razón social">
          <Input value={form.legal_name ?? ''} onChange={(e) => set('legal_name', e.target.value)} />
        </Field>
        <Field label="NIT / Registro">
          <Input value={form.tax_id ?? ''} onChange={(e) => set('tax_id', e.target.value)} />
        </Field>
        <Field label="Estado">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as ClientStatus)}>
            {Object.entries(CLIENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsable">
          <OwnerSelect value={form.owner_id} onChange={(v) => set('owner_id', v)} />
        </Field>
        <Field label="Industria / rubro">
          <Input value={form.industry ?? ''} onChange={(e) => set('industry', e.target.value)} />
        </Field>
        <Field label="Origen del contacto">
          <Input value={form.source ?? ''} onChange={(e) => set('source', e.target.value)} placeholder="Referido, web, visita…" />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Correo">
          <Input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Dirección" className="sm:col-span-2">
          <Input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Municipio / ciudad">
          <Input value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Departamento">
          <Input value={form.department ?? ''} onChange={(e) => set('department', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">Ubicación en el mapa (opcional)</span>
          <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-slate-100" />}>
            <LocationPicker
              lat={form.latitude}
              lng={form.longitude}
              query={[form.address, form.city, form.department].filter(Boolean).join(', ')}
              onChange={(la, ln) => setForm((f) => ({ ...f, latitude: la, longitude: ln }))}
            />
          </Suspense>
        </div>
        <Field label="Necesidades detectadas" className="sm:col-span-2">
          <Textarea value={form.needs ?? ''} onChange={(e) => set('needs', e.target.value)} />
        </Field>
        <Field label="Notas internas" className="sm:col-span-2">
          <Textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Contacto
// ---------------------------------------------------------------------
export function ContactFormModal({
  open,
  onClose,
  clientId,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  contact?: Contact | null;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({ full_name: '', position: '', email: '', phone: '', is_primary: false, notes: '' });

  useEffect(() => {
    if (!open) return;
    setForm({
      full_name: contact?.full_name ?? '',
      position: contact?.position ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      is_primary: contact?.is_primary ?? false,
      notes: contact?.notes ?? '',
    });
  }, [open, contact]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim()) throw new Error('El nombre es obligatorio.');
      const payload = { ...clean(form), client_id: clientId };
      if (contact) await unwrap(supabase.from('contacts').update(payload).eq('id', contact.id));
      else await unwrap(supabase.from('contacts').insert(payload));
    },
    onSuccess: () => {
      toast.success('Contacto guardado');
      invalidate('contacts', 'client');
      onClose();
    },
    onError: toast.error,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contact ? 'Editar contacto' : 'Nuevo contacto'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo" required className="sm:col-span-2">
          <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field label="Cargo">
          <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Correo" className="sm:col-span-2">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Notas" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <Checkbox label="Contacto principal" checked={form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Visita
// ---------------------------------------------------------------------
interface VisitDraft {
  client_id: string;
  contact_id: string | null;
  title: string;
  objective: string;
  scheduled_at: string; // datetime-local
  duration_minutes: number;
  location: string;
  status: VisitStatus;
  comments: string;
  agreements: string;
  next_action: string;
  next_action_date: string;
  owner_id: string | null;
  create_task: boolean;
}

export function VisitFormModal({
  open,
  onClose,
  visit,
  defaultClientId,
}: {
  open: boolean;
  onClose: () => void;
  visit?: Visit | null;
  defaultClientId?: string;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: clients } = useClientOptions();
  const [form, setForm] = useState<VisitDraft | null>(null);
  const { data: contacts } = useContacts(form?.client_id);

  useEffect(() => {
    if (!open) return;
    setForm({
      client_id: visit?.client_id ?? defaultClientId ?? '',
      contact_id: visit?.contact_id ?? null,
      title: visit?.title ?? '',
      objective: visit?.objective ?? '',
      scheduled_at: visit ? toLocalInput(visit.scheduled_at) : `${addDaysISO(todayISO(), 1)}T09:00`,
      duration_minutes: visit?.duration_minutes ?? 60,
      location: visit?.location ?? '',
      status: visit?.status ?? 'programada',
      comments: visit?.comments ?? '',
      agreements: visit?.agreements ?? '',
      next_action: visit?.next_action ?? '',
      next_action_date: visit?.next_action_date ?? '',
      owner_id: visit?.owner_id ?? session?.user.id ?? null,
      create_task: !visit,
    });
  }, [open, visit, defaultClientId, session]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      if (!form.client_id) throw new Error('Elegí un cliente.');
      if (!form.title.trim()) throw new Error('El asunto es obligatorio.');
      if (!form.scheduled_at) throw new Error('Indicá fecha y hora.');
      const { create_task, ...rest } = form;
      const payload = clean({ ...rest, scheduled_at: fromLocalInput(form.scheduled_at) });
      let visitId = visit?.id;
      if (visit) await unwrap(supabase.from('visits').update(payload).eq('id', visit.id));
      else visitId = ((await unwrap(supabase.from('visits').insert(payload).select('id').single())) as { id: string }).id;

      // Próxima acción → tarea de seguimiento (opcional)
      if (create_task && form.next_action.trim() && form.next_action_date) {
        await unwrap(
          supabase.from('tasks').insert({
            title: form.next_action.trim(),
            due_date: form.next_action_date,
            client_id: form.client_id,
            visit_id: visitId,
            owner_id: form.owner_id,
            priority: 'media',
          }),
        );
      }
    },
    onSuccess: () => {
      toast.success('Visita guardada');
      invalidate('visits', 'tasks', 'client', 'dashboard');
      onClose();
    },
    onError: toast.error,
  });

  if (!form) return null;
  const set = <K extends keyof VisitDraft>(k: K, v: VisitDraft[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={visit ? 'Editar visita' : 'Nueva visita'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cliente" required>
          <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value, contact_id: null })}>
            <option value="">Seleccionar…</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contacto">
          <Select value={form.contact_id ?? ''} onChange={(e) => set('contact_id', e.target.value || null)} disabled={!form.client_id}>
            <option value="">—</option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Asunto" required className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Objetivo" className="sm:col-span-2">
          <Textarea value={form.objective} onChange={(e) => set('objective', e.target.value)} />
        </Field>
        <Field label="Fecha y hora" required>
          <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)} />
        </Field>
        <Field label="Duración (min)">
          <Input type="number" min={5} step={5} value={form.duration_minutes} onChange={(e) => set('duration_minutes', Number(e.target.value))} />
        </Field>
        <Field label="Lugar">
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field label="Estado">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as VisitStatus)}>
            {Object.entries(VISIT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsable">
          <OwnerSelect value={form.owner_id} onChange={(v) => set('owner_id', v)} />
        </Field>
        <div />
        <Field label="Comentarios" className="sm:col-span-2">
          <Textarea value={form.comments} onChange={(e) => set('comments', e.target.value)} />
        </Field>
        <Field label="Acuerdos" className="sm:col-span-2">
          <Textarea value={form.agreements} onChange={(e) => set('agreements', e.target.value)} />
        </Field>
        <Field label="Próxima acción">
          <Input value={form.next_action} onChange={(e) => set('next_action', e.target.value)} />
        </Field>
        <Field label="Fecha próxima acción">
          <Input type="date" value={form.next_action_date} onChange={(e) => set('next_action_date', e.target.value)} />
        </Field>
        {!visit && (
          <Checkbox
            label="Crear tarea de seguimiento con la próxima acción"
            checked={form.create_task}
            onChange={(e) => set('create_task', e.target.checked)}
          />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Tarea
// ---------------------------------------------------------------------
export function TaskFormModal({
  open,
  onClose,
  task,
  defaultClientId,
  defaultQuoteId,
}: {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaultClientId?: string;
  defaultQuoteId?: string;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: clients } = useClientOptions();
  const [form, setForm] = useState({
    title: '',
    description: '',
    due_date: todayISO(),
    status: 'pendiente' as TaskStatus,
    priority: 'media' as TaskPriority,
    client_id: '' as string,
    owner_id: null as string | null,
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      title: task?.title ?? '',
      description: task?.description ?? '',
      due_date: task?.due_date ?? addDaysISO(todayISO(), 1),
      status: task?.status ?? 'pendiente',
      priority: task?.priority ?? 'media',
      client_id: task?.client_id ?? defaultClientId ?? '',
      owner_id: task?.owner_id ?? session?.user.id ?? null,
    });
  }, [open, task, defaultClientId, session]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error('El título es obligatorio.');
      const payload = clean({ ...form, quote_id: task?.quote_id ?? defaultQuoteId ?? null });
      if (task) await unwrap(supabase.from('tasks').update(payload).eq('id', task.id));
      else await unwrap(supabase.from('tasks').insert(payload));
    },
    onSuccess: () => {
      toast.success('Tarea guardada');
      invalidate('tasks', 'client', 'dashboard', 'quote');
      onClose();
    },
    onError: toast.error,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Editar tarea' : 'Nueva tarea de seguimiento'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Título" required className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
        </Field>
        <Field label="Descripción" className="sm:col-span-2">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Vence" required>
          <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </Field>
        <Field label="Prioridad">
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cliente">
          <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">—</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsable">
          <OwnerSelect value={form.owner_id} onChange={(v) => setForm({ ...form, owner_id: v })} />
        </Field>
        {task && (
          <Field label="Estado">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>
              {Object.entries(TASK_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
