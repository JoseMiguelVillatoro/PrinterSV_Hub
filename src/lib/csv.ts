// Exportación CSV en el navegador (UTF-8 con BOM para que Excel respete tildes).

type Cell = string | number | boolean | null | undefined;

function escape(value: Cell): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
}

export function downloadCSV(filename: string, headers: string[], rows: Cell[][]): void {
  const blob = new Blob(['﻿' + toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
