import { createClient, type PostgrestError } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Desenvuelve una respuesta de Supabase y lanza un error legible. */
export async function unwrap<T>(promise: PromiseLike<{ data: T; error: PostgrestError | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(humanizeError(error));
  return data;
}

export function humanizeError(error: { message: string; code?: string; details?: string | null }): string {
  const msg = error.message ?? 'Error desconocido';
  if (error.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'No tenés permisos para realizar esta acción.';
  }
  if (error.code === '23505') return 'Ya existe un registro con ese valor (duplicado).';
  if (error.code === '23503') return 'El registro está relacionado con otros datos y no se puede eliminar.';
  if (error.code === '23514') return 'Algún valor no es válido (revisá cantidades, precios o fechas).';
  return msg;
}
