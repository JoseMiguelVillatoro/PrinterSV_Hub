import { describe, expect, it } from 'vitest';
import { calcLine, calcQuote, round2 } from './quoteMath';

describe('round2', () => {
  it('redondea como Postgres (half away from zero)', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(500.2075)).toBe(500.21);
    expect(round2(139.88)).toBe(139.88);
    expect(round2(-1.005)).toBe(-1.01);
  });
});

describe('calcLine', () => {
  it('aplica descuento porcentual por línea', () => {
    expect(calcLine({ quantity: 5, unit_price: 789, discount_pct: 5, taxable: true })).toEqual({
      line_subtotal: 3945,
      line_discount: 197.25,
      line_total: 3747.75,
    });
  });
  it('acota el descuento entre 0 y 100', () => {
    expect(calcLine({ quantity: 1, unit_price: 10, discount_pct: 150, taxable: true }).line_total).toBe(0);
  });
});

// Mismos casos que supabase/tests/db_tests.sql
describe('calcQuote (igual que la base de datos)', () => {
  it('Q1 demo: laptops con descuento + línea personalizada', () => {
    const t = calcQuote(
      [
        { quantity: 5, unit_price: 789, discount_pct: 5, taxable: true },
        { quantity: 5, unit_price: 20, discount_pct: 0, taxable: true },
      ],
      [],
      13,
    );
    expect(t.subtotal).toBe(4045);
    expect(t.discount_total).toBe(197.25);
    expect(t.tax_total).toBe(500.21);
    expect(t.total).toBe(4347.96);
  });

  it('Q3 demo: cargo gravado y deducción no gravada', () => {
    const t = calcQuote(
      [
        { quantity: 12, unit_price: 45, discount_pct: 0, taxable: true },
        { quantity: 4, unit_price: 119, discount_pct: 0, taxable: true },
      ],
      [
        { kind: 'cargo', amount: 60, taxable: true },
        { kind: 'deduccion', amount: 40, taxable: false },
      ],
      13,
    );
    expect(t.subtotal).toBe(1016);
    expect(t.taxable_base).toBe(1076);
    expect(t.tax_total).toBe(139.88);
    expect(t.total).toBe(1175.88);
  });

  it('línea exenta + cargo de envío gravado', () => {
    const t = calcQuote(
      [
        { quantity: 3, unit_price: 139, discount_pct: 10, taxable: true },
        { quantity: 1, unit_price: 50, discount_pct: 0, taxable: false },
      ],
      [{ kind: 'cargo', amount: 10, taxable: true }],
      13,
    );
    expect(t.taxable_base).toBe(385.3);
    expect(t.tax_total).toBe(50.09);
    expect(t.total).toBe(485.39);
  });

  it('la base imponible nunca es negativa', () => {
    const t = calcQuote(
      [{ quantity: 1, unit_price: 10, discount_pct: 0, taxable: true }],
      [{ kind: 'deduccion', amount: 50, taxable: true }],
      13,
    );
    expect(t.taxable_base).toBe(0);
    expect(t.tax_total).toBe(0);
    expect(t.total).toBe(-40);
  });

  it('deducción por porcentaje sobre el neto (igual que la BD)', () => {
    const t = calcQuote(
      [
        { quantity: 2, unit_price: 545, discount_pct: 0, taxable: true },
        { quantity: 1, unit_price: 12.5, discount_pct: 0, taxable: true },
      ],
      [
        { kind: 'deduccion', amount: 0, percent: 10, taxable: true },
        { kind: 'cargo', amount: 15, taxable: true },
      ],
      13,
    );
    expect(t.deductions_total).toBe(110.25);
    expect(t.taxable_base).toBe(1007.25);
    expect(t.total).toBe(1138.19);
  });
});
