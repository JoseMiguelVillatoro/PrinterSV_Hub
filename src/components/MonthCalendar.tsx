import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { addDaysISO, todayISO, toLocalInput } from '@/lib/format';
import type { Task, Visit } from '@/lib/types';

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const VISIT_COLOR: Record<string, string> = {
  programada: 'border-l-brand-500 bg-brand-50 text-brand-800',
  realizada: 'border-l-emerald-500 bg-emerald-50 text-emerald-800',
  cancelada: 'border-l-slate-300 bg-slate-50 text-slate-500 line-through',
};

/** Calendario mensual de visitas (y tareas pendientes) en hora de El Salvador. */
export function MonthCalendar({
  month,
  onMonth,
  visits,
  tasks,
  onVisit,
  onTask,
}: {
  month: string; // 'YYYY-MM'
  onMonth: (m: string) => void;
  visits: Visit[];
  tasks: Task[];
  onVisit: (v: Visit) => void;
  onTask: (t: Task) => void;
}) {
  const today = todayISO();
  const [y, m] = month.split('-').map(Number);

  const days = useMemo(() => {
    const first = `${month}-01`;
    const dow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = lunes
    const start = addDaysISO(first, -dow);
    return Array.from({ length: 42 }, (_, i) => addDaysISO(start, i));
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, { visits: Visit[]; tasks: Task[] }>();
    const get = (d: string) => map.get(d) ?? map.set(d, { visits: [], tasks: [] }).get(d)!;
    for (const v of visits) get(toLocalInput(v.scheduled_at).slice(0, 10)).visits.push(v);
    for (const t of tasks) if (t.status === 'pendiente') get(t.due_date).tasks.push(t);
    return map;
  }, [visits, tasks]);

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const lastRowUsed = days.slice(35).some((d) => d.slice(0, 7) === month);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => onMonth(today.slice(0, 7))} className="h-8 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Hoy
        </button>
        <button onClick={() => shift(-1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Mes anterior">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button onClick={() => shift(1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Mes siguiente">
          <ChevronRight className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold text-navy-900">
          {MONTHS[m - 1]} {y}
        </h2>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="grid grid-cols-7 bg-slate-50 text-center text-xs font-semibold text-slate-500">
          {DOW.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {(lastRowUsed ? days : days.slice(0, 35)).map((d) => {
            const inMonth = d.slice(0, 7) === month;
            const items = byDay.get(d);
            return (
              <div key={d} className={clsx('min-h-[92px] border-t border-l border-slate-100 p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0', !inMonth && 'bg-slate-50/60')}>
                <span
                  className={clsx(
                    'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                    d === today ? 'bg-brand-500 font-semibold text-white' : inMonth ? 'text-slate-700' : 'text-slate-300',
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                <div className="mt-1 space-y-1">
                  {items?.visits.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => onVisit(v)}
                      title={`${v.title} · ${v.clients?.name ?? ''}`}
                      className={clsx('block w-full truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[11px] leading-tight', VISIT_COLOR[v.status])}
                    >
                      <span className="font-semibold">{toLocalInput(v.scheduled_at).slice(11)}</span> {v.clients?.name ?? v.title}
                    </button>
                  ))}
                  {items?.tasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onTask(t)}
                      title={t.title}
                      className={clsx(
                        'block w-full truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[11px] leading-tight',
                        d < today ? 'border-l-red-500 bg-red-50 text-red-700' : 'border-l-amber-500 bg-amber-50 text-amber-800',
                      )}
                    >
                      ✓ {t.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" /> Visita programada</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Visita realizada</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> Tarea pendiente</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Tarea atrasada</span>
      </div>
    </div>
  );
}
