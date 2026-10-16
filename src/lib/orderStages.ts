import type { OrderView } from './types';

/** Mismas reglas que update_order_stage en la base de datos (para mostrar solo lo que se puede hacer). */
export type FlowStage = 'compra' | 'recepcion' | 'preparacion' | 'entrega';

const RANK: Record<FlowStage, Record<string, number>> = {
  compra: { no_aplica: 0, pendiente: 0, solicitada: 1, comprada: 2 },
  recepcion: { no_aplica: 0, pendiente: 0, parcial: 1, recibida: 2 },
  preparacion: { pendiente: 0, en_proceso: 1, lista: 2 },
  entrega: { pendiente: 0, programada: 1, parcial: 2, entregada: 3 },
};
const ORDERED: Record<FlowStage, string[]> = {
  compra: ['pendiente', 'solicitada', 'comprada'],
  recepcion: ['pendiente', 'parcial', 'recibida'],
  preparacion: ['pendiente', 'en_proceso', 'lista'],
  entrega: ['pendiente', 'programada', 'parcial', 'entregada'],
};

type O = Pick<OrderView, 'requires_purchase' | 'purchase_status' | 'reception_status' | 'preparation_status' | 'delivery_status'>;

export const currentOf = (o: O, s: FlowStage): string =>
  s === 'compra' ? o.purchase_status : s === 'recepcion' ? o.reception_status : s === 'preparacion' ? o.preparation_status : o.delivery_status;

/** Si un avance no está permitido todavía, devuelve el motivo. */
export function blockedReason(o: O, s: FlowStage, value: string): string | null {
  if (s === 'recepcion' && ['parcial', 'recibida'].includes(value) && o.purchase_status !== 'comprada') return 'Primero la compra tiene que estar Comprada';
  if (s === 'preparacion') {
    if (value === 'en_proceso' && o.requires_purchase && !['parcial', 'recibida'].includes(o.reception_status)) return 'Primero tiene que llegar la mercadería (Recepción)';
    if (value === 'lista' && o.requires_purchase && o.reception_status !== 'recibida') return 'La Recepción tiene que estar completa';
  }
  if (s === 'entrega') {
    if (value === 'programada' && o.preparation_status === 'pendiente') return 'Primero iniciá la Preparación';
    if (['parcial', 'entregada'].includes(value) && o.preparation_status !== 'lista') return 'El pedido tiene que estar Listo';
  }
  return null;
}

/** Opciones para avanzar (siguientes valores), cada una con su bloqueo si aplica. */
export function forwardOptions(o: O, s: FlowStage) {
  const cur = RANK[s][currentOf(o, s)] ?? 0;
  return ORDERED[s].filter((v) => RANK[s][v] > cur).map((v) => ({ value: v, blocked: blockedReason(o, s, v) }));
}

/** Correcciones (retroceder): solo Admin y solo si las etapas siguientes no empezaron. */
export function backwardOptions(o: O, s: FlowStage): string[] {
  const laterStarted =
    (s === 'compra' && (['parcial', 'recibida'].includes(o.reception_status) || o.preparation_status !== 'pendiente' || o.delivery_status !== 'pendiente')) ||
    (s === 'recepcion' && (o.preparation_status !== 'pendiente' || o.delivery_status !== 'pendiente')) ||
    (s === 'preparacion' && o.delivery_status !== 'pendiente');
  if (laterStarted) return [];
  const cur = RANK[s][currentOf(o, s)] ?? 0;
  return ORDERED[s].filter((v) => RANK[s][v] < cur);
}

export const isBackward = (o: O, s: FlowStage, value: string) => (RANK[s][value] ?? 0) < (RANK[s][currentOf(o, s)] ?? 0);
