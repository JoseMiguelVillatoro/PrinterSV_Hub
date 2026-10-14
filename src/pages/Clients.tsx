import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClientFormModal } from '@/components/forms';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { profileName, useProfiles } from '@/hooks/data';
import { CLIENT_STATUS_LABEL } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { Client, ClientStatus } from '@/lib/types';

const STATUS_TONE: Record<ClientStatus, 'blue' | 'green' | 'slate'> = { prospecto: 'blue', activo: 'green', inactivo: 'slate' };

export function ClientsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | ClientStatus>('');
  const [owner, setOwner] = useState('');
  const [creating, setCreating] = useState(false);
  const { data: profiles } = useProfiles();

  const { data, isLoading, error } = useQuery({
    queryKey: ['clients', 'list'],
    queryFn: () => unwrap(supabase.from('clients').select('*').order('name')) as Promise<Client[]>,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (!status || c.status === status) &&
        (!owner || c.owner_id === owner) &&
        (!s || [c.name, c.legal_name, c.email, c.city, c.industry].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [data, search, status, owner]);

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle={data ? `${data.length} registrados · ${data.filter((c) => c.status === 'prospecto').length} prospectos` : undefined}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Nuevo cliente
          </Button>
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_180px_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Buscar por nombre, correo, ciudad…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ClientStatus | '')}>
            <option value="">Todos los estados</option>
            {Object.entries(CLIENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Todos los responsables</option>
            {profiles?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </Select>
        </div>
        <ErrorBox error={error} />
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No hay clientes con esos filtros" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th>Estado</Th>
                <Th className="hidden md:table-cell">Rubro</Th>
                <Th className="hidden md:table-cell">Ubicación</Th>
                <Th className="hidden lg:table-cell">Responsable</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/clientes/${c.id}`)}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Link to={`/clientes/${c.id}`} className="font-medium text-navy-900 hover:text-brand-600">
                        {c.name}
                      </Link>
                      <DemoBadge show={c.is_demo} />
                    </div>
                    <p className="text-xs text-slate-500">{c.email ?? c.phone ?? ''}</p>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</Badge>
                  </Td>
                  <Td className="hidden md:table-cell">{c.industry ?? '—'}</Td>
                  <Td className="hidden md:table-cell">{[c.city, c.department].filter(Boolean).join(', ') || '—'}</Td>
                  <Td className="hidden lg:table-cell">{profileName(profiles, c.owner_id)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ClientFormModal open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/clientes/${id}`)} />
    </>
  );
}
