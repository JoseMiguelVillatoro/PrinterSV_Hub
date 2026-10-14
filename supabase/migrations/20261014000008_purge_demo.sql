-- =====================================================================
-- Printer Business Hub — 0008: borrar datos demo (manual, solo admin)
-- Nunca se ejecuta automáticamente. Solo borra filas is_demo = true y lo
-- que cuelga de ellas. Si un registro real quedó ligado a un dato demo
-- (p. ej. una cotización real para un cliente demo), se detiene y avisa.
-- =====================================================================

create or replace function public.purge_demo_data()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.has_role('admin') and auth.uid() is not null then
    raise exception 'Solo un administrador puede borrar los datos demo';
  end if;

  if exists (select 1 from public.quotes q join public.clients c on c.id = q.client_id where c.is_demo and not q.is_demo) then
    raise exception 'Hay cotizaciones reales asociadas a clientes demo. Reasignalas antes de borrar los datos demo.';
  end if;

  perform public._begin_trusted();

  with
    po  as (delete from public.purchase_orders where is_demo returning 1),
    o   as (delete from public.orders where is_demo returning 1)
  select jsonb_build_object('purchase_orders', (select count(*) from po), 'orders', (select count(*) from o)) into v;

  with
    t  as (delete from public.tasks where is_demo returning 1),
    vi as (delete from public.visits where is_demo returning 1)
  select v || jsonb_build_object('tasks', (select count(*) from t), 'visits', (select count(*) from vi)) into v;

  with q as (delete from public.quotes where is_demo returning 1)
  select v || jsonb_build_object('quotes', (select count(*) from q)) into v;

  with
    ct as (delete from public.contacts where is_demo returning 1),
    c  as (delete from public.clients where is_demo returning 1)
  select v || jsonb_build_object('contacts', (select count(*) from ct), 'clients', (select count(*) from c)) into v;

  with
    p as (delete from public.products where is_demo returning 1),
    s as (delete from public.suppliers where is_demo returning 1)
  select v || jsonb_build_object('products', (select count(*) from p), 'suppliers', (select count(*) from s)) into v;

  perform public._end_trusted();
  return v;
end;
$$;

revoke execute on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;
