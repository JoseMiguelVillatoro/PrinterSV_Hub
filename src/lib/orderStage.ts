import type { OrderView } from './types';

/** Etapa actual de un pedido: cada pedido cae en UNA sola (la primera que le falta). */
export type OrderStage = 'compra' | 'recepcion' | 'preparacion' | 'entrega' | 'entregado' | 'cerrado' | 'cancelado';

export const ORDER_STAGES: { key: OrderStage; label: string; color: string }[] = [
  { key: 'compra', label: 'Por comprar', color: '#f59e0b' },
  { key: 'recepcion', label: 'Por recibir', color: '#8b5cf6' },
  { key: 'preparacion', label: 'En preparación', color: '#6366f1' },
  { key: 'entrega', label: 'Por entregar', color: '#1d6fe8' },
  { key: 'entregado', label: 'Entregado (por cerrar)', color: '#34d399' },
  { key: 'cerrado', label: 'Cerrado', color: '#059669' },
  { key: 'cancelado', label: 'Cancelado', color: '#cbd5e1' },
];

type StageFields = Pick<OrderView, 'status' | 'requires_purchase' | 'purchase_status' | 'reception_status' | 'preparation_status' | 'delivery_status'>;

export function orderStage(o: StageFields): OrderStage {
  if (o.status === 'cancelado') return 'cancelado';
  if (o.status === 'cerrado') return 'cerrado';
  if (o.requires_purchase && ['pendiente', 'solicitada'].includes(o.purchase_status)) return 'compra';
  if (o.requires_purchase && o.reception_status !== 'recibida' && o.reception_status !== 'no_aplica') return 'recepcion';
  if (o.preparation_status !== 'lista') return 'preparacion';
  if (o.delivery_status !== 'entregada') return 'entrega';
  return 'entregado';
}
