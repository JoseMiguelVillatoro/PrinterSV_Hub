import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus, FilePlus2, ListPlus, Pencil, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClientFormModal, ContactFormModal, TaskFormModal, VisitFormModal } from '@/components/forms';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Spinner } from '@/components/ui';
import { profileName, useProfiles } from '@/hooks/data';
import { useAuth } from '@/lib/auth';
import {
  CLIENT_STATUS_LABEL,
  DELIVERY_LABEL,
  PRIORITY_LABEL,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  VISIT_STATUS_LABEL,
  dateOnly,
  dateTime,
  money,
  stageTone,
  todayISO,
} from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { Client, Contact, Order, Quote, Task, Visit } from '@/lib/types';

interface Expediente {
  client: Client;
  contacts: Contact[];
  visits: Visit[];
  tasks: Task[];
  quotes: Quote[];
  orders: Order[];
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-800">{value || '—'}</dd>
    </div>
  );
}

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const { data: profiles } = useProfiles();
  const [editing, setEditing] = useState(false);
  const [contactModal, setContactModal] = useState<{ open: boolean; contact?: Contact | null }>({ open: false });
  const [visitModal, setVisitModal] = useState<{ open: boolean; visit?: Visit | null }>({ open: false });
  const [taskModal, setTaskModal] = useState<{ open: boolean; task?: Task | null }>({ open: false });

  const { data, isLoading, error } = useQuery({
    queryKey: ['client', id],
    queryFn: async (): Promise<Expediente> => {
      const [client, contacts, visits, tasks, quotes, orders] = await Promise.all([
        unwrap(supabase.from('clients').select('*').eq('id', id!).single()),
        unwrap(supabase.from('contacts').select('*').eq('client_id', id!).order('is_primary', { ascending: false })),
        unwrap(supabase.from('visits').select('*').eq('client_id', id!).order('scheduled_at', { ascending: false })),
        unwrap(supabase.from('tasks').select('*, quotes(number)').eq('client_id', id!).order('due_date')),
        unwrap(supabase.from('quotes').select('*').eq('client_id', id!).order('issue_date', { ascending: false })),
        unwrap(supabase.from('orders').select('*').eq('client_id', id!).order('created_at', { ascending: false })),
      ]);
      return {
        client: client as Client,
        contacts: contacts as Contact[],
        visits: visits as Visit[],
        tasks: tasks as Task[],
        quotes: quotes as Quote[],
        orders: orders as Order[],
      };
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error ?? 'Cliente no encontrado'} />;
  const { client, contacts, visits, tasks, quotes, orders } = data;
  const today = todayISO();
  const quotedTotal = quotes.filter((q) => !['borrador', 'cancelada'].includes(q.status)).reduce((a, q) => a + Number(q.total), 0);
  const acceptedTotal = quotes.filter((q) => q.status === 'aceptada').reduce((a, q) => a + Number(q.total), 0);

  return (
    <>
      <button onClick={() => navigate('/clientes')} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Clientes
      </button>

      <div className="mb-6 flex flex-col gap-4 rounded-xl bg-navy-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{client.name}</h1>
            <DemoBadge show={client.is_demo} />
          </div>
          <p className="mt-1 text-sm text-slate-300">
            {CLIENT_STATUS_LABEL[client.status]} · {client.industry ?? 'Sin rubro'} · Responsable: {profileName(profiles, client.owner_id)}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center sm:text-right">
          <div>
            <p className="text-xs text-slate-400">Cotizado</p>
            <p className="font-semibold">{money(quotedTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Aceptado</p>
            <p className="font-semibold text-accent-400">{money(acceptedTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Pedidos</p>
            <p className="font-semibold">{orders.length}</p>
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
          Editar
        </Button>
        {auth.canManageVisits && (
          <Button variant="secondary" size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setVisitModal({ open: true })}>
            Registrar visita
          </Button>
        )}
        <Button variant="secondary" size="sm" icon={<ListPlus className="h-4 w-4" />} onClick={() => setTaskModal({ open: true })}>
          Nueva tarea
        </Button>
        {auth.canManageQuotes && (
          <Button size="sm" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => navigate(`/cotizaciones/nueva?cliente=${client.id}`)}>
            Nueva cotización
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card title="Datos de la empresa">
            <dl className="grid gap-3">
              <Info label="Razón social" value={client.legal_name} />
              <Info label="NIT / Registro" value={client.tax_id} />
              <Info label="Teléfono" value={client.phone} />
              <Info label="Correo" value={client.email} />
              <Info label="Dirección" value={[client.address, client.city, client.department].filter(Boolean).join(', ')} />
              <Info label="Origen" value={client.source} />
              <Info label="Necesidades" value={client.needs} />
              <Info label="Notas" value={client.notes} />
            </dl>
          </Card>
          <Card
            title="Contactos"
            actions={
              <Button size="sm" variant="ghost" icon={<UserPlus className="h-4 w-4" />} onClick={() => setContactModal({ open: true })}>
                Agregar
              </Button>
            }
          >
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-500">Sin contactos.</p>
            ) : (
              <ul className="space-y-3">
                {contacts.map((c) => (
                  <li key={c.id} className="group flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {c.full_name} {c.is_primary && <Badge tone="cyan">Principal</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">{[c.position, c.phone, c.email].filter(Boolean).join(' · ')}</p>
                    </div>
                    <button className="text-xs text-brand-600 opacity-0 group-hover:opacity-100" onClick={() => setContactModal({ open: true, contact: c })}>
                      Editar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card title={`Cotizaciones (${quotes.length})`}>
            {quotes.length === 0 ? (
              <EmptyState title="Sin cotizaciones" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {quotes.map((q) => (
                  <li key={q.id}>
                    <Link to={`/cotizaciones/${q.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-600">
                      <div>
                        <p className="text-sm font-medium">{q.number}</p>
                        <p className="text-xs text-slate-500">
                          {q.title ?? 'Sin título'} · {dateOnly(q.issue_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{money(q.total, q.currency)}</span>
                        <Badge tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Pedidos y entregas (${orders.length})`}>
            {orders.length === 0 ? (
              <p className="text-sm text-slate-500">Sin pedidos.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link to={`/pedidos/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-600">
                      <span className="text-sm font-medium">{o.number}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm">{money(o.total)}</span>
                        <Badge tone={stageTone(o.delivery_status)}>Entrega: {DELIVERY_LABEL[o.delivery_status]}</Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Visitas (${visits.length})`}>
            {visits.length === 0 ? (
              <p className="text-sm text-slate-500">Sin visitas registradas.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-5">
                {visits.map((v) => (
                  <li key={v.id} className="relative">
                    <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">{v.title}</p>
                      <Badge tone={stageTone(v.status)}>{VISIT_STATUS_LABEL[v.status]}</Badge>
                      {auth.canManageVisits && (
                        <button className="text-xs text-brand-600" onClick={() => setVisitModal({ open: true, visit: v })}>
                          Editar
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{dateTime(v.scheduled_at)}</p>
                    {v.objective && <p className="mt-1 text-sm text-slate-600">Objetivo: {v.objective}</p>}
                    {v.comments && <p className="text-sm text-slate-600">Comentarios: {v.comments}</p>}
                    {v.agreements && <p className="text-sm text-slate-600">Acuerdos: {v.agreements}</p>}
                    {v.next_action && (
                      <p className="text-sm text-slate-600">
                        Próxima acción: {v.next_action} {v.next_action_date && `(${dateOnly(v.next_action_date)})`}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title={`Tareas (${tasks.filter((t) => t.status === 'pendiente').length} pendientes)`}>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-500">Sin tareas.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {tasks.map((t) => {
                  const late = t.status === 'pendiente' && t.due_date < today;
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                      <button className="text-left" onClick={() => setTaskModal({ open: true, task: t })}>
                        <p className={`text-sm font-medium ${t.status !== 'pendiente' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.title}</p>
                        <p className="text-xs text-slate-500">
                          {PRIORITY_LABEL[t.priority]} · {profileName(profiles, t.owner_id)}
                          {t.quotes?.number && ` · ${t.quotes.number}`}
                        </p>
                      </button>
                      <Badge tone={late ? 'red' : t.status === 'pendiente' ? 'blue' : 'green'}>
                        {late ? 'Atrasada · ' : ''}
                        {dateOnly(t.due_date)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <ClientFormModal open={editing} onClose={() => setEditing(false)} client={client} />
      <ContactFormModal open={contactModal.open} contact={contactModal.contact} clientId={client.id} onClose={() => setContactModal({ open: false })} />
      <VisitFormModal open={visitModal.open} visit={visitModal.visit} defaultClientId={client.id} onClose={() => setVisitModal({ open: false })} />
      <TaskFormModal open={taskModal.open} task={taskModal.task} defaultClientId={client.id} onClose={() => setTaskModal({ open: false })} />
    </>
  );
}
