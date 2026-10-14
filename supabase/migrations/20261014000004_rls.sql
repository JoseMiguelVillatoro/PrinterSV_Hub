-- =====================================================================
-- Printer Business Hub — 0004: Row Level Security
-- Regla general:
--   * anon no ve nada.
--   * Un usuario autenticado SIN rol no ve nada.
--   * Costos, márgenes y compras: solo admin + operaciones.
--   * Configuración, usuarios y auditoría: solo admin.
-- =====================================================================

-- anon fuera de todo
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_roles','company_settings','document_sequences',
    'clients','contacts','visits','tasks','suppliers',
    'products','product_costs','product_price_history',
    'quotes','quote_items','quote_item_costs','quote_adjustments','quote_events',
    'orders','order_items','order_events','purchase_orders','purchase_order_items',
    'audit_log','seed_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------- Perfiles y roles ----------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy user_roles_admin_insert on public.user_roles for insert to authenticated
  with check (public.has_role('admin'));
create policy user_roles_admin_delete on public.user_roles for delete to authenticated
  using (public.has_role('admin'));

-- ---------------- Configuración ----------------
create policy settings_select on public.company_settings for select to authenticated
  using (public.is_staff());
create policy settings_update on public.company_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy sequences_select on public.document_sequences for select to authenticated
  using (public.is_staff());
create policy sequences_update on public.document_sequences for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
-- El admin solo puede cambiar prefijo/relleno, no el correlativo.
revoke update on public.document_sequences from authenticated;
grant update (prefix, padding) on public.document_sequences to authenticated;

-- ---------------- CRM ----------------
create policy clients_select on public.clients for select to authenticated using (public.is_staff());
create policy clients_insert on public.clients for insert to authenticated with check (public.is_staff());
create policy clients_update on public.clients for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy clients_delete on public.clients for delete to authenticated using (public.has_role('admin'));

create policy contacts_select on public.contacts for select to authenticated using (public.is_staff());
create policy contacts_insert on public.contacts for insert to authenticated with check (public.is_staff());
create policy contacts_update on public.contacts for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy contacts_delete on public.contacts for delete to authenticated
  using (public.has_role('admin') or created_by = auth.uid());

-- Visitas: las gestiona el equipo comercial (y admin). Operaciones las consulta.
create policy visits_select on public.visits for select to authenticated using (public.is_staff());
create policy visits_insert on public.visits for insert to authenticated
  with check (public.has_any_role(array['admin','comercial']::public.app_role[]));
create policy visits_update on public.visits for update to authenticated
  using (public.has_any_role(array['admin','comercial']::public.app_role[]))
  with check (public.has_any_role(array['admin','comercial']::public.app_role[]));
create policy visits_delete on public.visits for delete to authenticated
  using (public.has_role('admin') or (created_by = auth.uid() and public.has_role('comercial')));

create policy tasks_select on public.tasks for select to authenticated using (public.is_staff());
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_staff());
create policy tasks_update on public.tasks for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_role('admin') or created_by = auth.uid());

-- ---------------- Proveedores y catálogo ----------------
create policy suppliers_select on public.suppliers for select to authenticated using (public.is_staff());
create policy suppliers_write on public.suppliers for insert to authenticated with check (public.can_see_costs());
create policy suppliers_update on public.suppliers for update to authenticated using (public.can_see_costs()) with check (public.can_see_costs());
create policy suppliers_delete on public.suppliers for delete to authenticated using (public.has_role('admin'));

create policy products_select on public.products for select to authenticated using (public.is_staff());
create policy products_insert on public.products for insert to authenticated with check (public.can_manage_quotes());
create policy products_update on public.products for update to authenticated using (public.can_manage_quotes()) with check (public.can_manage_quotes());
create policy products_delete on public.products for delete to authenticated using (public.has_role('admin'));

create policy product_costs_all on public.product_costs for all to authenticated
  using (public.can_see_costs()) with check (public.can_see_costs());

create policy price_history_select on public.product_price_history for select to authenticated using (public.is_staff());

-- ---------------- Cotizaciones ----------------
create policy quotes_select on public.quotes for select to authenticated using (public.is_staff());
create policy quotes_insert on public.quotes for insert to authenticated with check (public.can_manage_quotes());
create policy quotes_update on public.quotes for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());
create policy quotes_delete on public.quotes for delete to authenticated
  using (public.has_role('admin') and status = 'borrador');

create policy quote_items_select on public.quote_items for select to authenticated using (public.is_staff());
create policy quote_items_insert on public.quote_items for insert to authenticated with check (public.can_manage_quotes());
create policy quote_items_update on public.quote_items for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());
create policy quote_items_delete on public.quote_items for delete to authenticated using (public.can_manage_quotes());

create policy quote_item_costs_all on public.quote_item_costs for all to authenticated
  using (public.can_see_costs()) with check (public.can_see_costs());

create policy quote_adj_select on public.quote_adjustments for select to authenticated using (public.is_staff());
create policy quote_adj_insert on public.quote_adjustments for insert to authenticated with check (public.can_manage_quotes());
create policy quote_adj_update on public.quote_adjustments for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());
create policy quote_adj_delete on public.quote_adjustments for delete to authenticated using (public.can_manage_quotes());

-- Eventos: lectura para todos; comentarios manuales de cualquier rol.
-- Los eventos de estado los crean las funciones del servidor.
create policy quote_events_select on public.quote_events for select to authenticated using (public.is_staff());
create policy quote_events_comment on public.quote_events for insert to authenticated
  with check (public.is_staff() and event_type = 'comentario' and created_by = auth.uid()
              and from_status is null and to_status is null);

-- ---------------- Pedidos y compras ----------------
create policy orders_select on public.orders for select to authenticated using (public.is_staff());
-- Inserción solo vía convert_quote_to_order(); el trigger lo garantiza.
create policy orders_update on public.orders for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());

create policy order_items_select on public.order_items for select to authenticated using (public.is_staff());
create policy order_items_update on public.order_items for update to authenticated
  using (public.can_manage_quotes()) with check (public.can_manage_quotes());

create policy order_events_select on public.order_events for select to authenticated using (public.is_staff());

create policy po_all on public.purchase_orders for all to authenticated
  using (public.can_see_costs()) with check (public.can_see_costs());
create policy po_items_all on public.purchase_order_items for all to authenticated
  using (public.can_see_costs()) with check (public.can_see_costs());

-- ---------------- Auditoría y seed ----------------
create policy audit_select on public.audit_log for select to authenticated using (public.has_role('admin'));
create policy seed_runs_select on public.seed_runs for select to authenticated using (public.has_role('admin'));

-- Las tablas append-only no se editan desde el cliente.
revoke update, delete on public.audit_log, public.quote_events, public.order_events, public.product_price_history from authenticated;
revoke insert on public.audit_log, public.order_events, public.product_price_history, public.seed_runs from authenticated;

-- Funciones internas: nunca invocables desde la API.
revoke execute on function public._begin_trusted(), public._end_trusted(),
  public.next_document_number(text), public.recalc_quote_totals(uuid)
  from public, anon, authenticated;
