import { describe, expect, it } from 'vitest';
import { orderStage } from './orderStage';

const base = { status: 'abierto', requires_purchase: true, purchase_status: 'pendiente', reception_status: 'pendiente', preparation_status: 'pendiente', delivery_status: 'pendiente' } as const;

describe('orderStage', () => {
  it('sigue el orden compra → recepción → preparación → entrega', () => {
    expect(orderStage(base)).toBe('compra');
    expect(orderStage({ ...base, purchase_status: 'comprada' })).toBe('recepcion');
    expect(orderStage({ ...base, purchase_status: 'comprada', reception_status: 'parcial' })).toBe('recepcion');
    expect(orderStage({ ...base, purchase_status: 'comprada', reception_status: 'recibida' })).toBe('preparacion');
    expect(orderStage({ ...base, purchase_status: 'comprada', reception_status: 'recibida', preparation_status: 'lista' })).toBe('entrega');
    expect(orderStage({ ...base, purchase_status: 'comprada', reception_status: 'recibida', preparation_status: 'lista', delivery_status: 'entregada' })).toBe('entregado');
  });
  it('sin compra salta directo a preparación', () => {
    expect(orderStage({ ...base, requires_purchase: false, purchase_status: 'no_aplica', reception_status: 'no_aplica' })).toBe('preparacion');
  });
  it('cerrado y cancelado mandan', () => {
    expect(orderStage({ ...base, status: 'cerrado' })).toBe('cerrado');
    expect(orderStage({ ...base, status: 'cancelado' })).toBe('cancelado');
  });
});
