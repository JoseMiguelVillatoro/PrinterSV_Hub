import { useQuery } from '@tanstack/react-query';
import { Boxes, FileText, Search, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUOTE_STATUS_LABEL, money } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { QuoteStatus } from '@/lib/types';

/** Búsqueda global en clientes, cotizaciones y productos (consulta real a la BD, con RLS). */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(text.replace(/[^\p{L}\p{N}\s-]/gu, '').trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        box.current?.querySelector('input')?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const like = `%${term}%`;
      const [clients, quotes, products] = await Promise.all([
        unwrap(supabase.from('clients').select('id,name,city').or(`name.ilike.${like},legal_name.ilike.${like},email.ilike.${like}`).limit(5)),
        unwrap(supabase.from('v_quotes').select('id,number,client_name,status,total').or(`number.ilike.${like},client_name.ilike.${like},title.ilike.${like}`).limit(5)),
        unwrap(supabase.from('products').select('id,sku,name,sale_price').or(`name.ilike.${like},sku.ilike.${like},brand.ilike.${like}`).limit(5)),
      ]);
      return {
        clients: clients as { id: string; name: string; city: string | null }[],
        quotes: quotes as { id: string; number: string; client_name: string; status: QuoteStatus; total: number }[],
        products: products as { id: string; sku: string; name: string; sale_price: number }[],
      };
    },
  });

  const go = (to: string) => {
    setOpen(false);
    setText('');
    navigate(to);
  };
  const empty = data && !data.clients.length && !data.quotes.length && !data.products.length;

  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar clientes, cotizaciones, productos…"
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-12 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      <kbd className="pointer-events-none absolute right-2 top-2 hidden rounded border border-slate-200 bg-white px-1.5 text-[10px] text-slate-400 md:block">Ctrl K</kbd>
      {open && term.length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {isFetching && !data && <p className="px-3 py-2 text-sm text-slate-500">Buscando…</p>}
          {empty && <p className="px-3 py-2 text-sm text-slate-500">Sin resultados para “{term}”.</p>}
          {!!data?.clients.length && (
            <Group label="Clientes">
              {data.clients.map((c) => (
                <Item key={c.id} icon={<Users className="h-4 w-4" />} title={c.name} sub={c.city ?? ''} onClick={() => go(`/clientes/${c.id}`)} />
              ))}
            </Group>
          )}
          {!!data?.quotes.length && (
            <Group label="Cotizaciones">
              {data.quotes.map((q) => (
                <Item
                  key={q.id}
                  icon={<FileText className="h-4 w-4" />}
                  title={q.number}
                  sub={`${q.client_name} · ${QUOTE_STATUS_LABEL[q.status]} · ${money(q.total)}`}
                  onClick={() => go(`/cotizaciones/${q.id}`)}
                />
              ))}
            </Group>
          )}
          {!!data?.products.length && (
            <Group label="Productos y servicios">
              {data.products.map((p) => (
                <Item key={p.id} icon={<Boxes className="h-4 w-4" />} title={p.name} sub={`${p.sku} · ${money(p.sale_price)}`} onClick={() => go(`/productos?q=${encodeURIComponent(p.sku)}`)} />
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      {children}
    </div>
  );
}

function Item({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50">
      <span className="rounded-md bg-brand-50 p-1.5 text-brand-600">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-800">{title}</span>
        <span className="block truncate text-xs text-slate-500">{sub}</span>
      </span>
    </button>
  );
}
