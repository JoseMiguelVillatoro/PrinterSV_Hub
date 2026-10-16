import clsx from 'clsx';
import { X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Tour de bienvenida. Se muestra la primera vez que un usuario entra
 * (marca guardada en user_metadata.tour_completed_at de Supabase Auth, así
 * que vale para cualquier dispositivo) y se puede repetir desde "Mi cuenta".
 *
 * Cada paso apunta a un elemento con data-tour="…". Si el elemento no está
 * visible (p. ej. el menú lateral en el celular), la tarjeta sale centrada.
 */

type Auth = ReturnType<typeof useAuth>;
interface Step {
  target?: string;
  title: string;
  body: string;
  show?: (a: Auth) => boolean;
}

const STEPS: Step[] = [
  {
    title: '¡Bienvenido a Printer Business Hub! 👋',
    body: 'Te mostramos en un minuto dónde está cada cosa. Podés saltar el tour cuando querás y repetirlo desde "Mi cuenta".',
  },
  { target: '/', title: 'Dashboard', body: 'Tu resumen del negocio: clientes, cotizaciones, conversión, pedidos y lo que requiere atención hoy.' },
  { target: 'search', title: 'Búsqueda rápida', body: 'Encontrá clientes, cotizaciones o productos escribiendo aquí. Atajo: Ctrl + K.' },
  { target: '/clientes', title: 'Clientes', body: 'El expediente de cada empresa: contactos, visitas, cotizaciones, pedidos y tareas en un solo lugar.' },
  { target: '/agenda', title: 'Agenda y visitas', body: 'Calendario de visitas y tareas de seguimiento. Las atrasadas se marcan en rojo.' },
  {
    target: '/cotizaciones',
    title: 'Cotizaciones',
    body: 'Seguí cada cotización desde borrador hasta aceptada o rechazada, con su historial y PDF listo para enviar.',
  },
  {
    target: 'new-quote',
    title: 'Nueva cotización',
    body: 'Creá una cotización con productos del catálogo o líneas personalizadas. El número, el IVA y los totales se calculan solos.',
    show: (a) => a.canManageQuotes,
  },
  {
    target: '/pedidos',
    title: 'Pedidos y entregas',
    body: 'Cuando una cotización se acepta, se convierte en pedido. Aquí se controla compra, recepción, preparación y entrega por separado.',
  },
  {
    target: '/compras',
    title: 'Compras',
    body: 'Todas las órdenes de compra a proveedores, de un pedido o generales (bodega, repuestos, insumos): PDF, envío por correo y recepción.',
    show: (a) => a.canSeeCosts,
  },
  { target: '/productos', title: 'Productos y servicios', body: 'El catálogo para cotizar, con historial de precios por cliente.' },
  { target: '/reportes', title: 'Reportes', body: 'Historial de precios, desempeño por responsable y motivos de rechazo. Todo se exporta a CSV.' },
  {
    target: '/configuracion',
    title: 'Configuración',
    body: 'Datos de la empresa para el PDF, numeración, usuarios y roles. Solo la ven los administradores.',
    show: (a) => a.isAdmin,
  },
  { target: 'account', title: 'Mi cuenta', body: 'Cambiá tu nombre o tu contraseña, y repetí este tour cuando querás.' },
  { title: '¡Listo! 🎉', body: 'Ya podés empezar. Los registros marcados como "Demo" son de prueba y se pueden borrar más adelante.' },
];

function findVisible(target: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`));
  return els.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;
}

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useAuth();
  const steps = useMemo(() => STEPS.filter((s) => !s.show || s.show(auth)), [auth]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const measure = useCallback(() => {
    if (!step?.target) return setRect(null);
    const el = findVisible(step.target);
    if (!el) return setRect(null);
    el.scrollIntoView({ block: 'nearest' });
    setRect(el.getBoundingClientRect());
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, measure]);

  const finish = useCallback(async () => {
    onClose();
    // Marca en la cuenta del usuario (no requiere tablas ni migraciones).
    await supabase.auth.updateUser({ data: { tour_completed_at: new Date().toISOString() } });
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void finish();
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, steps.length - 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish, steps.length]);

  if (!open || !step) return null;
  const last = i === steps.length - 1;

  // Posición de la tarjeta: a la derecha del elemento si cabe (menú lateral),
  // si no debajo; siempre dentro de la pantalla.
  const W = Math.min(340, window.innerWidth - 32);
  let style: React.CSSProperties;
  if (rect) {
    const pad = 12;
    const right = rect.right + pad + W <= window.innerWidth - 16;
    let left = right ? rect.right + pad : Math.min(Math.max(rect.left, 16), window.innerWidth - W - 16);
    let top = right ? rect.top - 8 : rect.bottom + pad;
    if (top + 220 > window.innerHeight) top = Math.max(16, (right ? rect.bottom : rect.top) - 220 - pad);
    left = Math.max(16, left);
    style = { left, top, width: W };
  } else {
    style = { left: '50%', top: '50%', width: W, transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Tour de bienvenida">
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-xl ring-2 ring-accent-400 transition-all duration-200"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(6, 15, 36, 0.62)',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-navy-950/60" />
      )}

      <div className="fixed rounded-2xl bg-white p-5 shadow-2xl" style={style}>
        <button onClick={() => void finish()} className="absolute right-3 top-3 rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar tour">
          <X className="h-4 w-4" />
        </button>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
          Paso {i + 1} de {steps.length}
        </p>
        <h3 className="mt-1 pr-6 text-base font-semibold text-navy-900">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
        <div className="mt-4 flex items-center gap-1">
          {steps.map((_, n) => (
            <span key={n} className={clsx('h-1.5 rounded-full transition-all', n === i ? 'w-5 bg-brand-500' : 'w-1.5 bg-slate-200')} />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button onClick={() => void finish()} className="text-sm text-slate-500 hover:text-slate-700">
            {last ? '' : 'Saltar tour'}
          </button>
          <div className="flex gap-2">
            {i > 0 && (
              <button onClick={() => setI(i - 1)} className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Atrás
              </button>
            )}
            <button
              onClick={() => (last ? void finish() : setI(i + 1))}
              className="h-9 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600"
              autoFocus
            >
              {i === 0 ? 'Empezar' : last ? 'Terminar' : 'Siguiente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ¿Este usuario ya completó (o saltó) el tour? */
export function tourDone(auth: Auth): boolean {
  return Boolean(auth.session?.user.user_metadata?.tour_completed_at);
}
