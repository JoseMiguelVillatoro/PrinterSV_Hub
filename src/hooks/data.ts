import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import type { Client, CompanySettings, Contact, Product, Profile, Supplier } from '@/lib/types';

// Consultas compartidas entre módulos (listas para selects).

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => unwrap(supabase.from('profiles').select('*').order('full_name')) as Promise<Profile[]>,
    staleTime: 60_000,
  });
}

export function useClientOptions() {
  return useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () =>
      unwrap(supabase.from('clients').select('id,name,status,is_demo').order('name')) as Promise<
        Pick<Client, 'id' | 'name' | 'status' | 'is_demo'>[]
      >,
  });
}

export function useContacts(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ['contacts', clientId],
    enabled: Boolean(clientId),
    queryFn: () =>
      unwrap(supabase.from('contacts').select('*').eq('client_id', clientId!).order('is_primary', { ascending: false })) as Promise<Contact[]>,
  });
}

export function useProducts(activeOnly = false) {
  return useQuery({
    queryKey: ['products', { activeOnly }],
    queryFn: () => {
      let q = supabase.from('products').select('*').order('name');
      if (activeOnly) q = q.eq('is_active', true);
      return unwrap(q) as Promise<Product[]>;
    },
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: () => unwrap(supabase.from('suppliers').select('*').order('name')) as Promise<Supplier[]>,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => unwrap(supabase.from('company_settings').select('*').eq('id', 1).single()) as Promise<CompanySettings>,
    staleTime: 5 * 60_000,
  });
}

export function profileName(profiles: Profile[] | undefined, id: string | null | undefined): string {
  if (!id) return '—';
  return profiles?.find((p) => p.id === id)?.full_name || '—';
}
