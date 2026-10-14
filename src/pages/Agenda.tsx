import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarPlus, Check, ListPlus, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TaskFormModal, VisitFormModal } from '@/components/forms';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, PageHeader, Select, Spinner } from '@/components/ui';
import { profileName, useProfiles } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import { PRIORITY_LABEL, VISIT_STATUS_LABEL, dateOnly, dateTime, stageTone, todayISO, toLocalInput } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { Task, Visit } from '@/lib/types';

type Tab = 'visitas' | 'tareas';

export function AgendaPage() {
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: profiles } = useProfiles();
  const [tab, setTab] = useState<Tab>('visitas');
  const [owner, setOwner] = useState<string>('');
  const [visitScope, setVisitScope] = useState<'proximas' | 'pasadas'>('proximas');
  const [taskScope, setTaskScope] = useState<'pendientes' | 'atrasadas' | 'todas'>('pendientes');
  const [visitModal, setVisitModal] = useState<{ open: boolean; visit?: Visit | null }>({ open: false });
  const [taskModal, setTaskModal] = useState<{ open: boolean; task?: Task | null }>({ open: false });
  const today = todayISO();

  const visits = useQuery({
    queryKey: ['visits', 'agenda'],
    queryFn: () => unwrap(supabase.from('visits').select('*, clients(name)').order('scheduled_at')) as Promise<Visit[]>,
  });
  const tasks = useQuery({
    queryKey: ['tasks', 'agenda'],
    queryFn: () => unwrap(supabase.from('tasks').select('*, clients(name), quotes(number)').order('due_date')) as Promise<Task[]>,
  });

  const complete = useMutation({
    mutationFn: (t: Task) => unwrap(supabase.from('tasks').update({ status: 'completada' }).eq('id', t.id)),
    onSuccess: () => {
      toast.success('Tarea completada');
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: toast.error,
  });

  const visitGroups = useMemo(() => {
    const list = (visits.data ?? []).filter((v) => {
      const day = toLocalInput(v.scheduled_at).slice(0, 10);
      const upcoming = day >= today && v.status === 'programada';
      return (!owner || v.owner_id === owner) && (visitScope === 'proximas' ? upcoming : !upcoming);
    });
    if (visitScope === 'pasadas') list.reverse();
    const groups = new Map<string, Visit[]>();
    for (const v of list) {
      const day = toLocalInput(v.scheduled_at).slice(0, 10);
      groups.set(day, [...(groups.get(day) ?? []), v]);
    }
    return [...groups.entries()];
  }, [visits.data, owner, visitScope, today]);

  const taskRows = useMemo(
    () =>
      (tasks.data ?? []).filter(
        (t) =>
          (!owner || t.owner_id === owner) &&
          (taskScope === 'todas' ||
            (taskScope === 'pendientes' && t.status === 'pendiente') ||
            (taskScope === 'atrasadas' && t.status === 'pendiente' && t.due_date < today)),
      ),
    [tasks.data, owner, taskScope, today],
  );
  const lateCount = (tasks.data ?? []).filter((t) => t.status === 'pendiente' && t.due_date < today).length;

  return (
    <>
      <PageHeader
        title="Agenda y seguimiento"
        subtitle="Visitas a clientes, acuerdos y tareas pendientes"
        actions={
          <>
            <Button variant="secondary" icon={<ListPlus className="h-4 w-4" />} onClick={() => setTaskModal({ open: true })}>
              Nueva tarea
            </Button>
            {auth.canManageVisits && (
              <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setVisitModal({ open: true })}>
                Nueva visita
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {(['visitas', 'tareas'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx('rounded-md px-4 py-1.5 text-sm font-medium capitalize', tab === t ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50')}
            >
              {t}
              {t === 'tareas' && lateCount > 0 && <span className="ml-2 rounded-full bg-red-500 px-1.5 text-xs text-white">{lateCount}</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {tab === 'visitas' ? (
            <Select value={visitScope} onChange={(e) => setVisitScope(e.target.value as typeof visitScope)} className="w-40">
              <option value="proximas">Próximas</option>
              <option value="pasadas">Historial</option>
            </Select>
          ) : (
            <Select value={taskScope} onChange={(e) => setTaskScope(e.target.value as typeof taskScope)} className="w-40">
              <option value="pendientes">Pendientes</option>
              <option value="atrasadas">Atrasadas</option>
              <option value="todas">Todas</option>
            </Select>
          )}
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="w-48">
            <option value="">Todo el equipo</option>
            {profiles?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {tab === 'visitas' ? (
        <Card>
          <ErrorBox error={visits.error} />
          {visits.isLoading ? (
            <Spinner />
          ) : visitGroups.length === 0 ? (
            <EmptyState title={visitScope === 'proximas' ? 'No hay visitas programadas' : 'Sin visitas en el historial'} />
          ) : (
            <div className="space-y-6">
              {visitGroups.map(([day, list]) => (
                <div key={day}>
                  <p className={clsx('mb-2 text-xs font-semibold uppercase tracking-wide', day === today ? 'text-brand-600' : 'text-slate-500')}>
                    {day === today ? 'Hoy · ' : ''}
                    {dateOnly(day)}
                  </p>
                  <ul className="space-y-2">
                    {list.map((v) => (
                      <li key={v.id} className="flex flex-col gap-2 rounded-lg border border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-navy-900">{dateTime(v.scheduled_at).slice(-5)}</span>
                            <span className="text-sm font-medium text-slate-800">{v.title}</span>
                            <Badge tone={stageTone(v.status)}>{VISIT_STATUS_LABEL[v.status]}</Badge>
                            <DemoBadge show={v.is_demo} />
                          </div>
                          <p className="text-xs text-slate-500">
                            <Link to={`/clientes/${v.client_id}`} className="text-brand-600 hover:underline">
                              {v.clients?.name}
                            </Link>
                            {v.location && (
                              <>
                                {' '}
                                · <MapPin className="inline h-3 w-3" /> {v.location}
                              </>
                            )}{' '}
                            · {profileName(profiles, v.owner_id)}
                          </p>
                          {v.objective && <p className="mt-1 text-sm text-slate-600">{v.objective}</p>}
                          {v.next_action && <p className="mt-1 text-xs text-slate-500">Próxima acción: {v.next_action}</p>}
                        </div>
                        {auth.canManageVisits && (
                          <Button size="sm" variant="secondary" onClick={() => setVisitModal({ open: true, visit: v })}>
                            {v.status === 'programada' ? 'Registrar resultado' : 'Ver / editar'}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <ErrorBox error={tasks.error} />
          {tasks.isLoading ? (
            <Spinner />
          ) : taskRows.length === 0 ? (
            <EmptyState title="No hay tareas con ese filtro" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {taskRows.map((t) => {
                const late = t.status === 'pendiente' && t.due_date < today;
                return (
                  <li key={t.id} className="flex items-center gap-3 py-3">
                    {t.status === 'pendiente' ? (
                      <button
                        title="Marcar como completada"
                        onClick={() => complete.mutate(t)}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-emerald-500 text-white">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <button className="flex-1 text-left" onClick={() => setTaskModal({ open: true, task: t })}>
                      <p className={clsx('text-sm font-medium', t.status !== 'pendiente' ? 'text-slate-400 line-through' : 'text-slate-800')}>
                        {t.title} <DemoBadge show={t.is_demo} />
                      </p>
                      <p className="text-xs text-slate-500">
                        {[t.clients?.name, t.quotes?.number, PRIORITY_LABEL[t.priority], profileName(profiles, t.owner_id)].filter(Boolean).join(' · ')}
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
      )}

      <VisitFormModal open={visitModal.open} visit={visitModal.visit} onClose={() => setVisitModal({ open: false })} />
      <TaskFormModal open={taskModal.open} task={taskModal.task} onClose={() => setTaskModal({ open: false })} />
    </>
  );
}
