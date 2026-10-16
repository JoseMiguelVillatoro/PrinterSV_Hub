import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { dateOnly, money, num } from './format';
import type { Client, CompanySettings, Contact, PurchaseOrder, PurchaseOrderItem, Quote, QuoteAdjustment, QuoteItem, Supplier } from './types';

const NAVY: [number, number, number] = [11, 27, 63];
const BLUE: [number, number, number] = [29, 111, 232];
const CYAN: [number, number, number] = [6, 182, 212];
const GRAY: [number, number, number] = [100, 116, 139];
const DEFAULT_LOGO = '/logo.png';
const PHOTO = 40; // tamaño de la miniatura en el PDF (pt)

type LoadedImage = { data: string; w: number; h: number; format: 'PNG' | 'JPEG' };

/**
 * Descarga una imagen y la reduce a `maxPx` (lado mayor) antes de meterla al PDF,
 * para que el archivo pese poco aunque la imagen original sea grande.
 * PNG conserva transparencia (logo); JPEG con fondo blanco para fotos.
 * Si no carga (CORS, enlace roto), devuelve null y el PDF sale sin esa imagen.
 */
async function loadImage(url: string, maxPx: number, format: 'PNG' | 'JPEG'): Promise<LoadedImage | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const src = await new Promise<HTMLImageElement>((resolve, reject) => {
      const u = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(u);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(u);
        reject(new Error('imagen inválida'));
      };
      img.src = u;
    });
    const scale = Math.min(1, maxPx / Math.max(src.naturalWidth, src.naturalHeight));
    const w = Math.max(1, Math.round(src.naturalWidth * scale));
    const h = Math.max(1, Math.round(src.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    if (format === 'JPEG') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    const data = canvas.toDataURL(format === 'PNG' ? 'image/png' : 'image/jpeg', 0.85);
    return { data, w, h, format };
  } catch {
    return null;
  }
}

/**
 * Encabezado común de los documentos (cotización, orden de compra): franja, logo,
 * datos de la empresa y, a la derecha, título, número y datos del documento.
 * Devuelve la altura (y) donde puede empezar el contenido.
 */
async function drawDocHeader(doc: jsPDF, settings: CompanySettings, title: string, number: string, meta: string[]): Promise<number> {
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  // Franja superior
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 6, 'F');
  doc.setFillColor(...CYAN);
  doc.rect(0, 6, W, 2, 'F');

  // Logo (configurado o el de la marca incluido en la app) + nombre
  let y = 36;
  const customLogo = settings.logo_url ? await loadImage(settings.logo_url, 400, 'PNG') : null;
  const logo = customLogo ?? (await loadImage(DEFAULT_LOGO, 160, 'PNG'));
  if (customLogo) {
    const h = 48;
    const w = Math.min((customLogo.w / customLogo.h) * h, 190);
    doc.addImage(customLogo.data, 'PNG', M, y - 10, w, h);
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
  doc.text(title, W - M, y + 12, { align: 'right' });
  doc.setFontSize(11);
  doc.setTextColor(...BLUE);
  doc.text(`No. ${number}`, W - M, y + 30, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text(
    meta.filter(Boolean),
    W - M,
    y + 48,
    { align: 'right' },
  );

  return Math.max(y + 54 + companyLines.length * 11, 130) + 14;
}

/** Pie común en cada página: leyenda, contacto y "No. · Página x de y". */
function drawDocFooter(doc: jsPDF, settings: CompanySettings, legend: string, number: string) {
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(226, 232, 240);
    doc.line(M, H - 36, W - M, H - 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(legend, M, H - 24);
    const contactLine = [settings.phone, settings.email, settings.website].filter(Boolean).join('   ·   ');
    if (contactLine) {
      doc.setTextColor(...BLUE);
      doc.text(contactLine, M, H - 13);
    }
    doc.text(`${number} · Página ${p} de ${pages}`, W - M, H - 24, { align: 'right' });
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
  /** product_id → URL de la foto del catálogo (solo se usa si quote.show_images). */
  productImages?: Record<string, string>;
}

/** Genera el PDF de una cotización. Usa los totales guardados en la base de datos. */
export async function buildQuotePdf({ quote, items, adjustments, client, contact, settings, ownerName, productImages }: QuotePdfData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const cur = quote.currency;

  // Fotos de las líneas (en paralelo con el logo)
  const photoUrls = quote.show_images && productImages ? productImages : {};
  const photosPromise = Promise.all(
    items.map((it) => (it.product_id && photoUrls[it.product_id] ? loadImage(photoUrls[it.product_id], 180, 'JPEG') : Promise.resolve(null))),
  );
  const photos = await photosPromise;
  const withPhotos = photos.some(Boolean);
  let y = await drawDocHeader(doc, settings, 'COTIZACIÓN', quote.number, [
    `Fecha: ${dateOnly(quote.issue_date)}`,
    `Válida hasta: ${dateOnly(quote.valid_until)}`,
    ownerName ? `Atendido por: ${ownerName}` : '',
  ]);

  // Cliente
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
  const head = ['#', ...(withPhotos ? [''] : []), 'Descripción', 'Cant.', 'Precio unit.', ...(hasDiscount ? ['Desc.'] : []), 'Total'];
  const body = items.map((it, idx) => [
    String(idx + 1),
    ...(withPhotos ? [''] : []),
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
    bodyStyles: withPhotos ? { minCellHeight: PHOTO + 8, valign: 'middle' } : undefined,
    columnStyles: (() => {
      const o = withPhotos ? 1 : 0; // con fotos, todo se corre una columna
      return {
        0: { cellWidth: 22, halign: 'center' as const },
        ...(withPhotos ? { 1: { cellWidth: PHOTO + 8 } } : {}),
        [2 + o]: { halign: 'right' as const, cellWidth: 60 },
        [3 + o]: { halign: 'right' as const, cellWidth: 72 },
        ...(hasDiscount
          ? { [4 + o]: { halign: 'right' as const, cellWidth: 44 }, [5 + o]: { halign: 'right' as const, cellWidth: 78 } }
          : { [4 + o]: { halign: 'right' as const, cellWidth: 78 } }),
      };
    })(),
    didDrawCell: (d) => {
      if (!withPhotos || d.section !== 'body' || d.column.index !== 1) return;
      const img = photos[d.row.index];
      if (!img) return;
      // Miniatura centrada y proporcional dentro de un cuadro de PHOTO × PHOTO
      const r = Math.min(PHOTO / img.w, PHOTO / img.h);
      const w = img.w * r;
      const h = img.h * r;
      const x = d.cell.x + (d.cell.width - w) / 2;
      const yy = d.cell.y + (d.cell.height - h) / 2;
      doc.addImage(img.data, 'JPEG', x, yy, w, h, undefined, 'FAST');
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(d.cell.x + (d.cell.width - PHOTO) / 2 - 1, d.cell.y + (d.cell.height - PHOTO) / 2 - 1, PHOTO + 2, PHOTO + 2, 3, 3, 'S');
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

  drawDocFooter(doc, settings, settings.quote_footer ?? 'Este documento es una cotización comercial y no constituye una factura fiscal.', quote.number);

  return doc;
}

// ---------------------------------------------------------------------
// Orden de compra (para el proveedor)
// ---------------------------------------------------------------------
export interface PurchaseOrderPdfData {
  po: PurchaseOrder;
  items: PurchaseOrderItem[];
  supplier: Supplier;
  settings: CompanySettings;
  /** Número del pedido interno (referencia; el proveedor no ve datos del cliente). */
  orderNumber?: string | null;
  authorName?: string | null;
}

/** PDF de una orden de compra con el mismo diseño que las cotizaciones. Totales tomados de la base de datos. */
export async function buildPurchaseOrderPdf({ po, items, supplier, settings, orderNumber, authorName }: PurchaseOrderPdfData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;

  let y = await drawDocHeader(doc, settings, 'ORDEN DE COMPRA', po.number, [
    `Fecha: ${dateOnly(po.ordered_at ?? po.created_at.slice(0, 10))}`,
    po.expected_at ? `Entrega esperada: ${dateOnly(po.expected_at)}` : '',
    orderNumber ? `Ref. interna: ${orderNumber}` : '',
    authorName ? `Elaborada por: ${authorName}` : '',
  ]);

  // Dos cajas: proveedor | entregar y facturar
  const boxW = (W - 2 * M - 12) / 2;
  const boxH = 84;
  const box = (x: number, title: string, heading: string, lines: string[]) => {
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, boxW, boxH, 6, 6, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(title, x + 12, y + 16);
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text(doc.splitTextToSize(heading, boxW - 24)[0] as string, x + 12, y + 31);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const wrapped = lines.filter(Boolean).flatMap((l) => doc.splitTextToSize(l, boxW - 24) as string[]).slice(0, 4);
    doc.text(wrapped, x + 12, y + 45);
  };
  box(M, 'PROVEEDOR', supplier.name, [
    supplier.tax_id ? `NIT: ${supplier.tax_id}` : '',
    supplier.address ?? '',
    [supplier.contact_name && `Atención: ${supplier.contact_name}`, supplier.phone].filter(Boolean).join(' · '),
    supplier.email ?? '',
  ]);
  box(M + boxW + 12, 'ENTREGAR Y FACTURAR A', settings.legal_name || settings.company_name, [
    [settings.tax_id && `NIT: ${settings.tax_id}`, settings.nrc && `NRC: ${settings.nrc}`].filter(Boolean).join('   '),
    `Entrega: ${po.delivery_address || settings.address || 'Coordinar con Printer'}`,
    `Condiciones de pago: ${po.payment_terms || 'A convenir'}`,
  ]);
  y += boxH + 18;

  // Líneas
  autoTable(doc, {
    startY: y,
    head: [['#', 'Descripción', 'Cantidad', 'Costo unit.', 'Total']],
    body: items.map((it, i) => [
      String(i + 1),
      it.description,
      num(it.quantity, 3),
      money(it.unit_cost),
      money(Math.round(Number(it.quantity) * Number(it.unit_cost) * 100) / 100),
    ]),
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 5, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      2: { halign: 'right', cellWidth: 64 },
      3: { halign: 'right', cellWidth: 78 },
      4: { halign: 'right', cellWidth: 84 },
    },
  });

  // Totales
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ty = (doc as any).lastAutoTable.finalY + 14;
  const rows: [string, string, boolean?][] = [
    ['Subtotal', money(po.total_cost)],
    [`IVA (${num(po.tax_rate, 2)} %)`, money(po.tax_total)],
    ['TOTAL', money(po.grand_total), true],
  ];
  const tW = 230;
  const x0 = W - M - tW;
  if (ty + 90 > H - 60) {
    doc.addPage();
    ty = 50;
  }
  for (const [label, value, strong] of rows) {
    if (strong) {
      doc.setFillColor(...BLUE);
      doc.roundedRect(x0, ty - 11, tW, 22, 4, 4, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(255, 255, 255);
      doc.text(label, x0 + 10, ty + 4);
      doc.text(value, W - M - 10, ty + 4, { align: 'right' });
      ty += 26;
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text(label, x0 + 10, ty);
      doc.text(value, W - M - 10, ty, { align: 'right' });
      ty += 15;
    }
  }

  // Notas e instrucciones
  let ny = ty + 8;
  const blocks: [string, string][] = [];
  if (po.notes) blocks.push(['Notas', po.notes]);
  blocks.push([
    'Instrucciones',
    [
      `• Favor confirmar la recepción de esta orden y la fecha de entrega.`,
      `• Facturar a nombre de ${settings.legal_name || settings.company_name}${settings.tax_id ? ` (NIT ${settings.tax_id}${settings.nrc ? `, NRC ${settings.nrc}` : ''})` : ''} e indicar el número ${po.number} en la factura.`,
      `• No se aceptan cambios de producto, cantidad o precio sin autorización por escrito.`,
    ].join('\n'),
  ]);
  for (const [title, text] of blocks) {
    const lines = doc.splitTextToSize(text, W - 2 * M);
    if (ny + 20 + lines.length * 11 > H - 120) {
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

  // Firma
  const sy = Math.max(ny + 30, H - 110);
  doc.setDrawColor(148, 163, 184);
  doc.line(M, sy, M + 190, sy);
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  doc.text(['Autorizado por', settings.company_name], M, sy + 12);

  drawDocFooter(doc, settings, 'Orden de compra emitida por Printer Business Hub.', po.number);
  return doc;
}
