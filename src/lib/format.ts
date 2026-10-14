import type {
  AppRole,
  ClientStatus,
  DeliveryStage,
  OrderStatus,
  PoStatus,
  PreparationStage,
  PurchaseStage,
  QuoteStatus,
  ReceptionStage,
  TaskPriority,
  TaskStatus,
  VisitStatus,
} from './types';

const TZ = 'America/El_Salvador';

export function money(value: number | null | undefined, currency = 'USD'): string {
  return new Intl.NumberFormat('es-SV', { style: 'currency', currency, minimumFractionDigits: 2 }).format(
    Number(value ?? 0),
  );
}

export function num(value: number | null | undefined, digits = 0): string {
  return new Intl.NumberFormat('es-SV', { maximumFractionDigits: digits }).format(Number(value ?? 0));
}

/** Fecha 'YYYY-MM-DD' (columna date) → dd/mm/aaaa sin corrimiento de zona horaria. */
export function dateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-SV', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** Hoy en El Salvador como 'YYYY-MM-DD'. */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** timestamptz → valor para <input type="datetime-local"> en hora local de El Salvador. */
export function toLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** <input type="datetime-local"> (hora de El Salvador, UTC−6 sin horario de verano) → ISO. */
export function fromLocalInput(value: string): string {
  return new Date(`${value}:00-06:00`).toISOString();
}

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: 'Administrador',
  comercial: 'Comercial',
  operaciones: 'Cotizaciones/Operaciones',
};

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  prospecto: 'Prospecto',
  activo: 'Activo',
  inactivo: 'Inactivo',
};

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  programada: 'Programada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pendiente: 'Pendiente',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = { baja: 'Baja', media: 'Media', alta: 'Alta' };

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  borrador: 'Borrador',
  pendiente_envio: 'Pendiente de envío',
  enviada: 'Enviada',
  negociacion: 'En negociación',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
  cancelada: 'Cancelada',
};

export const QUOTE_STATUSES = Object.keys(QUOTE_STATUS_LABEL) as QuoteStatus[];

/** Mismo mapa que quote_transition_allowed() en la base de datos. */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  borrador: ['pendiente_envio', 'enviada', 'cancelada'],
  pendiente_envio: ['borrador', 'enviada', 'cancelada'],
  enviada: ['negociacion', 'aceptada', 'rechazada', 'vencida', 'cancelada'],
  negociacion: ['enviada', 'aceptada', 'rechazada', 'vencida', 'cancelada'],
  vencida: ['negociacion', 'enviada', 'cancelada'],
  aceptada: [],
  rechazada: [],
  cancelada: [],
};

export const QUOTE_EDITABLE: QuoteStatus[] = ['borrador', 'pendiente_envio', 'enviada', 'negociacion'];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  abierto: 'Abierto',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
};
export const PURCHASE_LABEL: Record<PurchaseStage, string> = {
  no_aplica: 'No aplica',
  pendiente: 'Pendiente',
  solicitada: 'Solicitada',
  comprada: 'Comprada',
};
export const RECEPTION_LABEL: Record<ReceptionStage, string> = {
  no_aplica: 'No aplica',
  pendiente: 'Pendiente',
  parcial: 'Parcial',
  recibida: 'Recibida',
};
export const PREPARATION_LABEL: Record<PreparationStage, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  lista: 'Lista',
};
export const DELIVERY_LABEL: Record<DeliveryStage, string> = {
  pendiente: 'Pendiente',
  programada: 'Programada',
  parcial: 'Parcial',
  entregada: 'Entregada',
};
export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  recibida_parcial: 'Recibida parcial',
  recibida: 'Recibida',
  cancelada: 'Cancelada',
};

export type Tone = 'slate' | 'blue' | 'cyan' | 'amber' | 'green' | 'red' | 'violet';

export const QUOTE_STATUS_TONE: Record<QuoteStatus, Tone> = {
  borrador: 'slate',
  pendiente_envio: 'violet',
  enviada: 'blue',
  negociacion: 'amber',
  aceptada: 'green',
  rechazada: 'red',
  vencida: 'red',
  cancelada: 'slate',
};

export function stageTone(value: string): Tone {
  if (['comprada', 'recibida', 'lista', 'entregada', 'cerrado', 'realizada', 'completada'].includes(value)) return 'green';
  if (['no_aplica', 'cancelado', 'cancelada'].includes(value)) return 'slate';
  if (['parcial', 'en_proceso', 'solicitada', 'programada', 'recibida_parcial'].includes(value)) return 'amber';
  return 'blue';
}
