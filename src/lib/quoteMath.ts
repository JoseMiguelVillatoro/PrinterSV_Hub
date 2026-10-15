// Cálculo de cotizaciones — vista previa en el navegador.
// La FUENTE DE VERDAD es la base de datos (recalc_quote_totals en
// supabase/migrations/..._logic.sql). Esta función replica exactamente
// la misma fórmula y redondeo para que lo que se ve al editar coincida
// con lo que se guarda. Las pruebas de quoteMath.test.ts usan los mismos
// casos que supabase/tests/db_tests.sql.

export interface LineInput {
  quantity: number;
  unit_price: number;
  discount_pct: number;
  taxable: boolean;
}

export interface AdjustmentInput {
  kind: 'cargo' | 'deduccion';
  amount: number;
  /** Si viene, el monto es este % del neto de las líneas (igual que en la BD). */
  percent?: number | null;
  taxable: boolean;
}

/** Monto efectivo de un cargo/deducción (fijo o porcentual sobre el neto de líneas). */
export function adjustmentAmount(a: AdjustmentInput, net: number): number {
  if (a.percent !== null && a.percent !== undefined && String(a.percent) !== '') return round2((net * Number(a.percent)) / 100);
  return Number(a.amount) || 0;
}

export interface LineResult {
  line_subtotal: number;
  line_discount: number;
  line_total: number;
}

export interface QuoteTotals {
  subtotal: number;
  discount_total: number;
  net: number;
  charges_total: number;
  deductions_total: number;
  taxable_base: number;
  tax_total: number;
  total: number;
}

/** Redondeo a 2 decimales "half away from zero", igual que round() de Postgres para numeric. */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  // Trabajar en centavos con un épsilon para evitar errores de coma flotante (1.005 → 1.01)
  return (sign * Math.round(Math.abs(value) * 100 + 1e-8)) / 100;
}

/** Suma en centavos enteros para evitar acumulación de error. */
function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;
}

export function calcLine(line: LineInput): LineResult {
  const qty = Number(line.quantity) || 0;
  const price = Number(line.unit_price) || 0;
  const pct = Math.min(Math.max(Number(line.discount_pct) || 0, 0), 100);
  const line_subtotal = round2(qty * price);
  const line_discount = round2((line_subtotal * pct) / 100);
  return { line_subtotal, line_discount, line_total: round2(line_subtotal - line_discount) };
}

export function calcQuote(lines: LineInput[], adjustments: AdjustmentInput[], taxRate: number): QuoteTotals {
  const computed = lines.map((l) => ({ ...calcLine(l), taxable: l.taxable }));

  const subtotal = sumCents(computed.map((l) => l.line_subtotal));
  const discount_total = sumCents(computed.map((l) => l.line_discount));
  const net = sumCents(computed.map((l) => l.line_total));
  const taxableLines = sumCents(computed.filter((l) => l.taxable).map((l) => l.line_total));

  const adj = adjustments.map((a) => ({ ...a, value: adjustmentAmount(a, net) }));
  const charges = adj.filter((a) => a.kind === 'cargo');
  const deductions = adj.filter((a) => a.kind === 'deduccion');
  const charges_total = sumCents(charges.map((a) => a.value));
  const deductions_total = sumCents(deductions.map((a) => a.value));
  const taxableCharges = sumCents(charges.filter((a) => a.taxable).map((a) => a.value));
  const taxableDeductions = sumCents(deductions.filter((a) => a.taxable).map((a) => a.value));

  const taxable_base = Math.max(sumCents([taxableLines, taxableCharges, -taxableDeductions]), 0);
  const tax_total = round2((taxable_base * (Number(taxRate) || 0)) / 100);
  const total = sumCents([net, charges_total, -deductions_total, tax_total]);

  return { subtotal, discount_total, net, charges_total, deductions_total, taxable_base, tax_total, total };
}
