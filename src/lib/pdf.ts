import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { dateOnly, money, num } from './format';
import type { Client, CompanySettings, Contact, Quote, QuoteAdjustment, QuoteItem } from './types';

const NAVY: [number, number, number] = [11, 27, 63];
const BLUE: [number, number, number] = [29, 111, 232];
const CYAN: [number, number, number] = [6, 182, 212];
const GRAY: [number, number, number] = [100, 116, 139];
const DEFAULT_LOGO = '/logo.png';

async function loadImage(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = data;
    });
    return { data, ...dims };
  } catch {
    return null; // Si el logo no carga (CORS, URL inválida), el PDF sale sin logo.
  }
}

export interface QuotePdfData {
  quote: Quote;
  items: QuoteItem[];
  adjustments: QuoteAdjustment[];
  client: Client;
  contact: Contact | null;
  settings: CompanySettings;
  ownerName?: string | null;
}

/** Genera el PDF de una cotización. Usa los totales guardados en la base de datos. */
export async function buildQuotePdf({ quote, items, adjustments, client, contact, settings, ownerName }: QuotePdfData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const cur = quote.currency;

  // Franja superior
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 6, 'F');
  doc.setFillColor(...CYAN);
  doc.rect(0, 6, W, 2, 'F');

  // Logo (configurado o el de la marca incluido en la app) + nombre
  let y = 36;
  const customLogo = settings.logo_url ? await loadImage(settings.logo_url) : null;
  const logo = customLogo ?? (await loadImage(DEFAULT_LOGO));
  if (customLogo) {
    const h = 48;
    const w = Math.min((customLogo.w / customLogo.h) * h, 190);
    doc.addImage(customLogo.data, customLogo.data.includes('image/png') ? 'PNG' : 'JPEG', M, y - 10, w, h);
  } else {
    if (logo) doc.addImage(logo.data, 'PNG', M, y - 12, (logo.w / logo.h) * 50, 50);
    const tx = M + (logo ? (logo.w / logo.h) * 50 + 10 : 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(...NAVY);
    doc.text(settings.company_name.split(' ')[0] || 'Printer', tx, y + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(settings.company_name.split(' ').slice(1).join(' ') || '', tx + 1, y + 30);
  }

  // Datos de la empresa (solo los que estén configurados — no se inventan)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  const companyLines = [
    settings.legal_name,
    [settings.tax_id && `NIT: ${settings.tax_id}`, settings.nrc && `NRC: ${settings.nrc}`].filter(Boolean).join('   '),
    settings.address,
    [settings.phone, settings.email, settings.website].filter(Boolean).join(' · '),
  ].filter((l): l is string => Boolean(l && l.trim()));
  doc.text(companyLines, M, y + 56);

  // Bloque derecho: título y número
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...NAVY);
  doc.text('COTIZACIÓN', W - M, y + 12, { align: 'right' });
  doc.setFontSize(11);
  doc.setTextColor(...BLUE);
  doc.text(`No. ${quote.number}`, W - M, y + 30, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text(
    [`Fecha: ${dateOnly(quote.issue_date)}`, `Válida hasta: ${dateOnly(quote.valid_until)}`, ownerName ? `Atendido por: ${ownerName}` : ''].filter(Boolean),
    W - M,
    y + 48,
    { align: 'right' },
  );

  // Cliente
  y = Math.max(y + 54 + companyLines.length * 11, 130) + 14;
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, W - 2 * M, 64, 6, 6, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text('CLIENTE', M + 12, y + 16);
  doc.setFontSize(11);
  doc.setTextColor(...NAVY);
  doc.text(client.legal_name || client.name, M + 12, y + 31);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  const clientInfo = [
    [client.tax_id && `NIT: ${client.tax_id}`, [client.address, client.city, client.department].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
    contact ? [`Atención: ${contact.full_name}`, contact.position, contact.email, contact.phone].filter(Boolean).join(' · ') : client.email ?? '',
  ].filter(Boolean);
  doc.text(clientInfo, M + 12, y + 45);

  if (quote.title) {
    y += 80;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text(quote.title, M, y);
    y += 8;
  } else {
    y += 74;
  }

  // Líneas
  const hasDiscount = items.some((i) => Number(i.discount_pct) > 0);
  const head = ['#', 'Descripción', 'Cant.', 'Precio unit.', ...(hasDiscount ? ['Desc.'] : []), 'Total'];
  const body = items.map((it, idx) => [
    String(idx + 1),
    `${it.description}${it.sku ? `\nSKU: ${it.sku}` : ''}${it.taxable ? '' : '  (exento)'}`,
    `${num(it.quantity, 3)} ${it.unit}`,
    money(it.unit_price, cur),
    ...(hasDiscount ? [Number(it.discount_pct) > 0 ? `${num(it.discount_pct, 2)} %` : '—'] : []),
    money(it.line_total, cur),
  ]);

  autoTable(doc, {
    startY: y + 6,
    head: [head],
    body,
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 5, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      2: { halign: 'right', cellWidth: 60 },
      3: { halign: 'right', cellWidth: 72 },
      ...(hasDiscount ? { 4: { halign: 'right', cellWidth: 44 }, 5: { halign: 'right', cellWidth: 78 } } : { 4: { halign: 'right', cellWidth: 78 } }),
    },
  });

  // Totales
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ty = (doc as any).lastAutoTable.finalY + 14;
  const rows: [string, string, boolean?][] = [['Subtotal', money(Number(quote.subtotal), cur)]];
  if (Number(quote.discount_total) > 0) rows.push(['Descuentos por línea', `- ${money(quote.discount_total, cur)}`]);
  for (const a of adjustments) {
    rows.push([
      `${a.label}${a.percent ? ` (${num(a.percent, 2)} %)` : ''}${a.taxable ? '' : ' · no gravado'}`,
      `${a.kind === 'cargo' ? '+' : '-'} ${money(a.amount, cur)}`,
    ]);
  }
  rows.push([`Base imponible`, money(quote.taxable_base, cur)]);
  rows.push([`IVA (${num(quote.tax_rate, 2)} %)`, money(quote.tax_total, cur)]);
  rows.push(['TOTAL', money(quote.total, cur), true]);

  const boxW = 250;
  const x0 = W - M - boxW;
  if (ty + rows.length * 28 + 40 > doc.internal.pageSize.getHeight() - 60) {
    doc.addPage();
    ty = 50;
  }
  doc.setFontSize(9);
  for (const [label, value, strong] of rows) {
    if (strong) {
      doc.setFillColor(...BLUE);
      doc.roundedRect(x0, ty - 11, boxW, 22, 4, 4, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(255, 255, 255);
      doc.text(label, x0 + 10, ty + 4);
      doc.text(value, W - M - 10, ty + 4, { align: 'right' });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      // Etiquetas largas se parten en varias líneas y el renglón crece en consecuencia
      const lines = doc.splitTextToSize(label, boxW - 100) as string[];
      doc.text(lines, x0 + 10, ty);
      doc.text(value, W - M - 10, ty, { align: 'right' });
      ty += (lines.length - 1) * 11;
    }
    ty += strong ? 26 : 15;
  }

  // Notas y condiciones
  let ny = ty + 10;
  const blocks = [
    ['Notas', quote.notes],
    ['Condiciones comerciales', quote.terms ?? settings.default_quote_terms],
  ].filter(([, v]) => v) as [string, string][];
  for (const [title, text] of blocks) {
    const bullets = title === 'Condiciones comerciales'
      ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => (l.startsWith('-') || l.startsWith('•') ? `• ${l.replace(/^[-•]\s*/, '')}` : `• ${l}`)).join('\n')
      : text;
    const lines = doc.splitTextToSize(bullets, W - 2 * M);
    if (ny + 20 + lines.length * 11 > doc.internal.pageSize.getHeight() - 50) {
      doc.addPage();
      ny = 50;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...NAVY);
    doc.text(title, M, ny);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(lines, M, ny + 13);
    ny += 22 + lines.length * 11;
  }

  // Pie en cada página
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(226, 232, 240);
    doc.line(M, H - 36, W - M, H - 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(settings.quote_footer ?? 'Este documento es una cotización comercial y no constituye una factura fiscal.', M, H - 24);
    const contactLine = [settings.phone, settings.email, settings.website].filter(Boolean).join('   ·   ');
    if (contactLine) {
      doc.setTextColor(...BLUE);
      doc.text(contactLine, M, H - 13);
    }
    doc.text(`${quote.number} · Página ${p} de ${pages}`, W - M, H - 24, { align: 'right' });
  }

  return doc;
}
