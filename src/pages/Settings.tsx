import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { profileName, useProfiles, useSettings } from '@/hooks/data';
import { useToast } from '@/hooks/toast';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL, dateTime } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { AppRole, CompanySettings, DocumentSequence } from '@/lib/types';

type Tab = 'empresa' | 'numeracion' | 'usuarios' | 'auditoria';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('empresa');
  const tabs: [Tab, string][] = [
    ['empresa', 'Empresa e impuestos'],
    ['numeracion', 'Numeración'],
    ['usuarios', 'Usuarios y roles'],
    ['auditoria', 'Auditoría'],
  ];
  return (
    <>
      <PageHeader title="Configuración" subtitle="Solo administradores" />
      <div className="mb-4 flex gap-2 overflow-x-auto">
        {tabs.map(([k, v]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx('shrink-0 rounded-lg px-4 py-2 text-sm font-medium', tab === k ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}
          >
            {v}
          </button>
        ))}
      </div>
      {tab === 'empresa' && (
        <div className="space-y-6">
          <CompanyTab />
          <DemoDataCard />
        </div>
      )}
      {tab === 'numeracion' && <SequencesTab />}
      {tab === 'usuarios' && <UsersTab />}
      {tab === 'auditoria' && <AuditTab />}
    </>
  );
}

function CompanyTab() {
  const { data, isLoading } = useSettings();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<CompanySettings | null>(null);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  const m = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const { id: _id, ...rest } = form;
      const payload = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v === '' ? null : v]));
      await unwrap(supabase.from('company_settings').update(payload).eq('id', 1));
    },
    onSuccess: () => {
      toast.success('Configuración guardada');
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: toast.error,
  });
  if (isLoading || !form) return <Spinner />;
  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) => setForm({ ...form, [k]: v });
  return (
    <Card title="Datos que aparecen en el PDF de cotización" actions={<Button loading={m.isPending} onClick={() => m.mutate()}>Guardar</Button>}>
      <p className="mb-4 text-sm text-slate-500">Los campos vacíos no se imprimen. No se completan datos fiscales automáticamente.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre comercial">
          <Input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} />
        </Field>
        <Field label="Razón social">
          <Input value={form.legal_name ?? ''} onChange={(e) => set('legal_name', e.target.value)} />
        </Field>
        <Field label="NIT">
          <Input value={form.tax_id ?? ''} onChange={(e) => set('tax_id', e.target.value)} />
        </Field>
        <Field label="NRC">
          <Input value={form.nrc ?? ''} onChange={(e) => set('nrc', e.target.value)} />
        </Field>
        <Field label="Dirección" className="sm:col-span-2">
          <Input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Correo">
          <Input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Sitio web">
          <Input value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} />
        </Field>
        <Field label="URL del logo (PNG o JPG)" hint="Debe ser una URL pública que permita CORS (p. ej., Supabase Storage público)">
          <Input value={form.logo_url ?? ''} onChange={(e) => set('logo_url', e.target.value)} />
        </Field>
        {form.logo_url && (
          <div className="sm:col-span-2">
            <img src={form.logo_url} alt="Logo" className="h-12 rounded border border-slate-200 bg-white object-contain p-1" />
          </div>
        )}
        <Field label="IVA por defecto (%)" hint="Se copia a cada cotización nueva; se puede cambiar por cotización">
          <Input type="number" min={0} max={100} step="0.01" value={form.default_tax_rate} onChange={(e) => set('default_tax_rate', Number(e.target.value))} />
        </Field>
        <Field label="Vigencia por defecto (días)">
          <Input type="number" min={1} value={form.quote_validity_days} onChange={(e) => set('quote_validity_days', Number(e.target.value))} />
        </Field>
        <Field label="Condiciones comerciales por defecto" className="sm:col-span-2">
          <Textarea rows={4} value={form.default_quote_terms ?? ''} onChange={(e) => set('default_quote_terms', e.target.value)} />
        </Field>
        <Field label="Pie del PDF" className="sm:col-span-2">
          <Input value={form.quote_footer ?? ''} onChange={(e) => set('quote_footer', e.target.value)} />
        </Field>
      </div>
    </Card>
  );
}

function SequencesTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['sequences'],
    queryFn: () => unwrap(supabase.from('document_sequences').select('*').order('doc_type')) as Promise<DocumentSequence[]>,
  });
  const [edits, setEdits] = useState<Record<string, { prefix: string; padding: number }>>({});
  useEffect(() => {
    if (data) setEdits(Object.fromEntries(data.map((s) => [s.doc_type, { prefix: s.prefix, padding: s.padding }])));
  }, [data]);
  const m = useMutation({
    mutationFn: async () => {
      for (const [doc_type, v] of Object.entries(edits)) {
        if (!/^[A-Z0-9-]{2,12}$/.test(v.prefix)) throw new Error(`Prefijo inválido "${v.prefix}" (solo mayúsculas, números y guiones).`);
        await unwrap(supabase.from('document_sequences').update(v).eq('doc_type', doc_type));
      }
    },
    onSuccess: () => {
      toast.success('Numeración actualizada');
      void qc.invalidateQueries({ queryKey: ['sequences'] });
    },
    onError: toast.error,
  });
  const NAMES: Record<string, string> = { quote: 'Cotizaciones', order: 'Pedidos', purchase: 'Órdenes de compra' };
  return (
    <Card title="Formato de numeración" actions={<Button loading={m.isPending} onClick={() => m.mutate()}>Guardar</Button>}>
      <p className="mb-4 text-sm text-slate-500">
        El correlativo lo asigna la base de datos y se reinicia cada año. No se puede retroceder para evitar números duplicados.
      </p>
      <ErrorBox error={error} />
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {data?.map((s) => {
            const e = edits[s.doc_type] ?? { prefix: s.prefix, padding: s.padding };
            return (
              <div key={s.doc_type} className="grid items-end gap-3 sm:grid-cols-[180px_160px_120px_1fr]">
                <p className="pb-2 text-sm font-medium">{NAMES[s.doc_type]}</p>
                <Field label="Prefijo">
                  <Input value={e.prefix} onChange={(ev) => setEdits({ ...edits, [s.doc_type]: { ...e, prefix: ev.target.value.toUpperCase() } })} />
                </Field>
                <Field label="Dígitos">
                  <Input type="number" min={3} max={8} value={e.padding} onChange={(ev) => setEdits({ ...edits, [s.doc_type]: { ...e, padding: Number(ev.target.value) } })} />
                </Field>
                <p className="pb-2 text-sm text-slate-500">
                  Último: {s.last_value} ({s.current_year}) · Próximo: <b className="text-navy-900">{`${e.prefix}-${new Date().getFullYear()}-${String(s.current_year === new Date().getFullYear() ? s.last_value + 1 : 1).padStart(e.padding, '0')}`}</b>
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function UsersTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { session, refresh } = useAuth();
  const { data: profiles, isLoading } = useProfiles();
  const roles = useQuery({
    queryKey: ['user_roles'],
    queryFn: () => unwrap(supabase.from('user_roles').select('user_id, role')) as Promise<{ user_id: string; role: AppRole }[]>,
  });

  const toggleRole = useMutation({
    mutationFn: async ({ userId, role, on }: { userId: string; role: AppRole; on: boolean }) => {
      if (on) await unwrap(supabase.from('user_roles').insert({ user_id: userId, role }));
      else await unwrap(supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role));
    },
    onSuccess: async () => {
      void qc.invalidateQueries({ queryKey: ['user_roles'] });
      await refresh();
    },
    onError: toast.error,
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => unwrap(supabase.from('profiles').update({ is_active }).eq('id', id)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['profiles'] }),
    onError: toast.error,
  });

  const has = (u: string, r: AppRole) => roles.data?.some((x) => x.user_id === u && x.role === r) ?? false;

  return (
    <Card title="Usuarios">
      <div className="mb-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">
        Para agregar a alguien: en Supabase → Authentication → Users → <b>Invite user</b> con su correo. Cuando acepte la invitación aparecerá aquí y le asignás su rol.
        Sin rol no puede ver ningún dato.
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Usuario</Th>
              {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => (
                <Th key={r} className="text-center">
                  {ROLE_LABEL[r]}
                </Th>
              ))}
              <Th className="text-center">Activo</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {profiles?.map((p) => (
              <tr key={p.id}>
                <Td>
                  <p className="font-medium">
                    {p.full_name || '—'} {p.id === session?.user.id && <Badge tone="cyan">Vos</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{p.email}</p>
                </Td>
                {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => (
                  <Td key={r} className="text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-500"
                      checked={has(p.id, r)}
                      disabled={toggleRole.isPending}
                      onChange={(e) => toggleRole.mutate({ userId: p.id, role: r, on: e.target.checked })}
                    />
                  </Td>
                ))}
                <Td className="text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-500"
                    checked={p.is_active}
                    disabled={p.id === session?.user.id}
                    onChange={(e) => toggleActive.mutate({ id: p.id, is_active: e.target.checked })}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AuditTab() {
  const { data: profiles } = useProfiles();
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit'],
    queryFn: () =>
      unwrap(supabase.from('audit_log').select('id, table_name, record_id, action, changed_by, changed_at').order('changed_at', { ascending: false }).limit(200)) as Promise<
        { id: number; table_name: string; record_id: string; action: string; changed_by: string | null; changed_at: string }[]
      >,
  });
  return (
    <Card title="Últimos 200 cambios">
      <ErrorBox error={error} />
      {isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Tabla</Th>
              <Th>Acción</Th>
              <Th className="hidden sm:table-cell">Registro</Th>
              <Th>Usuario</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap">{dateTime(a.changed_at)}</Td>
                <Td>{a.table_name}</Td>
                <Td>
                  <Badge tone={a.action === 'delete' ? 'red' : a.action === 'insert' ? 'green' : 'blue'}>{a.action}</Badge>
                </Td>
                <Td className="hidden font-mono text-xs sm:table-cell">{a.record_id?.slice(0, 8)}</Td>
                <Td>{a.changed_by ? profileName(profiles, a.changed_by) : 'Sistema'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function DemoDataCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => unwrap(supabase.rpc('purge_demo_data')) as Promise<Record<string, number>>,
    onSuccess: (r) => {
      toast.success(`Datos demo borrados: ${Object.entries(r).map(([k, v]) => `${v} ${k}`).join(', ')}`);
      void qc.invalidateQueries();
    },
    onError: toast.error,
  });
  return (
    <Card title="Datos de demostración">
      <p className="text-sm text-slate-600">
        Los registros de prueba llevan la insignia <b>Demo</b>. Se cargaron una sola vez y no vuelven a aparecer aunque se borren.
        Borrarlos es definitivo y no afecta los registros reales.
      </p>
      <Button
        variant="danger"
        className="mt-4"
        loading={m.isPending}
        onClick={() => {
          if (window.confirm('¿Borrar TODOS los datos demo? Esta acción no se puede deshacer.')) m.mutate();
        }}
      >
        Borrar datos demo
      </Button>
    </Card>
  );
}
