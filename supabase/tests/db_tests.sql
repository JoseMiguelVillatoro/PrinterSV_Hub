-- Pruebas de base de datos: ejecutar sobre una BD recién migrada.
--   psql -v ON_ERROR_STOP=1 -f tests/db_tests.sql
-- Cada bloque usa ASSERT; el primer fallo detiene el script.
\set ON_ERROR_STOP 1

-- ---------- Usuarios de prueba ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'admin@test.local', '{"full_name":"Admin Test"}'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'comercial@test.local', '{"full_name":"Comercial Test"}'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'ops@test.local', '{"full_name":"Ops Test"}'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'sinrol@test.local', '{}');
insert into public.user_roles (user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'admin'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'comercial'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'operaciones');

-- ---------- 1. Seed: conteos y carga única ----------
do $$ begin
  assert (select count(*) from clients where is_demo) = 20, 'clientes demo (5 + 15 del mapa)';
  assert (select count(*) from clients where is_demo and latitude is not null) = 20, 'clientes demo con ubicación';
  assert (select count(*) from products where is_demo) = 8, 'productos demo';
  assert (select count(*) from quotes where is_demo) = 6, 'cotizaciones demo';
  assert (select count(distinct status) from quotes where is_demo) = 5, 'estados distintos';
  assert (select count(*) from visits where is_demo) = 7, 'visitas demo (3 + 4 del mapa)';
  assert (select count(*) from tasks where is_demo) = 3, 'tareas demo';
  assert (select count(*) from orders where is_demo) = 2, 'pedidos demo';
  assert (select count(*) from profiles) = 4, 'perfiles creados por trigger';
end $$;

select public.apply_demo_seed() as second_run;   -- debe decir skipped
\i migrations/20261014000006_demo_seed.sql
\i migrations/20261015000013_demo_map_clients.sql
do $$ begin
  assert (select count(*) from clients) = 20, 'seed duplicó clientes';
  assert (select count(*) from quotes) = 6, 'seed duplicó cotizaciones';
  assert (select count(*) from quote_items) = 12, 'seed duplicó líneas';
  assert (select count(*) from orders) = 2, 'seed duplicó pedidos';
  assert (select count(*) from seed_runs) = 2, 'seed_runs (demo + demo_map)';
  assert (select max(last_value) from document_sequences where doc_type = 'quote') = 6, 'numeración no avanzó en re-ejecución';
end $$;

-- ---------- 2. Totales calculados ----------
do $$
declare q record;
begin
  select * into q from quotes where id = 'd5000000-0000-4000-8000-000000000003';
  -- 12×45 + 4×119 = 1016; cargo gravado 60; deducción no gravada 40
  assert q.subtotal = 1016.00, 'Q3 subtotal ' || q.subtotal;
  assert q.taxable_base = 1076.00, 'Q3 base ' || q.taxable_base;
  assert q.tax_total = 139.88, 'Q3 iva ' || q.tax_total;
  assert q.total = 1175.88, 'Q3 total ' || q.total;

  select * into q from quotes where id = 'd5000000-0000-4000-8000-000000000001';
  -- 5×789 = 3945 − 5 % (197.25) = 3747.75 + 5×20 = 3847.75; IVA 500.21
  assert q.subtotal = 4045.00, 'Q1 subtotal ' || q.subtotal;
  assert q.discount_total = 197.25, 'Q1 desc ' || q.discount_total;
  assert q.tax_total = 500.21, 'Q1 iva ' || q.tax_total;
  assert q.total = 4347.96, 'Q1 total ' || q.total;

  assert (select string_agg(number, ',' order by number) from quotes) ~ '^PR-Q-\d{4}-0001,PR-Q-\d{4}-0002', 'formato número';
  assert (select count(distinct number) from quotes) = 6, 'números únicos';
end $$;

-- ---------- 3. RLS: anon ----------
set role anon;
do $$ begin
  begin
    perform count(*) from public.clients;
    assert false, 'anon pudo leer clientes';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------- 4. RLS: usuario sin rol ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000004', false);
set role authenticated;
do $$ begin
  assert (select count(*) from clients) = 0, 'sin rol ve clientes';
  assert (select count(*) from quotes) = 0, 'sin rol ve cotizaciones';
  assert (select count(*) from profiles) = 1, 'sin rol solo ve su perfil';
end $$;
reset role;

-- ---------- 5. RLS: comercial ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', false);
set role authenticated;
do $$
declare r record;
begin
  assert (select count(*) from clients) = 20, 'comercial no ve clientes';
  assert (select count(*) from product_costs) = 0, 'comercial ve costos';
  assert (select count(*) from quote_item_costs) = 0, 'comercial ve costos de línea';
  assert (select count(*) from purchase_orders) = 0, 'comercial ve OC';
  assert (select count(*) from v_quote_margins) = 0, 'comercial ve márgenes';
  assert (select count(*) from audit_log) = 0, 'comercial ve auditoría';

  -- puede crear clientes y visitas
  insert into clients (name) values ('Cliente real de prueba');
  insert into visits (client_id, title, scheduled_at)
    select id, 'Visita test', now() + interval '1 day' from clients where name = 'Cliente real de prueba';

  -- no puede crear cotizaciones
  begin
    insert into quotes (number, client_id) select '', id from clients limit 1;
    assert false, 'comercial creó cotización';
  exception when insufficient_privilege then null;
  end;

  -- no puede escribir costos
  begin
    insert into product_costs (product_id, unit_cost) values ('d4000000-0000-4000-8000-000000000001', 1);
    assert false, 'comercial escribió costo';
  exception when insufficient_privilege then null;
  end;

  -- update directo de cotización: RLS lo filtra (0 filas)
  update quotes set title = 'hack' where id = 'd5000000-0000-4000-8000-000000000002';
  assert (select title from quotes where id = 'd5000000-0000-4000-8000-000000000002') <> 'hack', 'comercial editó cotización';

  -- seguimiento y cambio de estado comercial
  perform change_quote_status('d5000000-0000-4000-8000-000000000002', 'negociacion', 'Cliente pidió ajuste');
  assert (select status from quotes where id = 'd5000000-0000-4000-8000-000000000002') = 'negociacion', 'comercial no movió estado';
  perform update_quote_followup('d5000000-0000-4000-8000-000000000002', 'Reunión con dirección', current_date + 3, null);

  -- no puede cancelar
  begin
    perform change_quote_status('d5000000-0000-4000-8000-000000000002', 'cancelada');
    assert false, 'comercial canceló';
  exception when raise_exception then null;
  end;

  -- comentario manual OK, evento de estado falso no
  insert into quote_events (quote_id, event_type, comment, created_by)
    values ('d5000000-0000-4000-8000-000000000002', 'comentario', 'nota', auth.uid());
  begin
    insert into quote_events (quote_id, event_type, to_status, created_by)
      values ('d5000000-0000-4000-8000-000000000002', 'estado', 'aceptada', auth.uid());
    assert false, 'comercial falsificó evento';
  exception when insufficient_privilege then null;
  end;

  -- no puede crear pedidos
  begin
    perform convert_quote_to_order('d5000000-0000-4000-8000-000000000001');
    assert false, 'comercial creó pedido';
  exception when raise_exception then null;
  end;

  -- no puede asignarse roles
  begin
    insert into user_roles (user_id, role) values (auth.uid(), 'admin');
    assert false, 'comercial se hizo admin';
  exception when insufficient_privilege then null;
  end;

  select * into r from dashboard_metrics();
  assert (dashboard_metrics() -> 'clients' ->> 'total')::int = 21, 'dashboard clientes';
end $$;
reset role;

-- ---------- 6. Operaciones: flujo completo ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', false);
set role authenticated;
do $$
declare
  v_q uuid;
  v_o uuid;
  v_num text;
  q record;
begin
  assert (select count(*) from product_costs) = 8, 'ops no ve costos';
  assert (select count(*) from v_quote_margins) = 6, 'ops no ve márgenes';

  -- número y totales los pone el servidor
  insert into quotes (number, client_id, status, total, tax_rate)
    select 'HACK-1', id, 'aceptada', 999999, 13 from clients where name = 'Cliente real de prueba'
  returning id, number into v_q, v_num;
  assert v_num ~ '^PR-Q-\d{4}-0007$', 'número asignado: ' || v_num;
  select * into q from quotes where id = v_q;
  assert q.status = 'borrador' and q.total = 0, 'insert respetó status/total del cliente';
  assert q.valid_until = q.issue_date + 15, 'vigencia por defecto';

  -- línea de catálogo + línea personalizada
  insert into quote_items (quote_id, position, product_id, description, quantity, unit_price, discount_pct)
    values (v_q, 1, 'd4000000-0000-4000-8000-000000000003', 'Monitor', 3, 139.00, 10);
  insert into quote_items (quote_id, position, description, quantity, unit_price, taxable)
    values (v_q, 2, 'Servicio exento personalizado', 1, 50.00, false);
  insert into quote_adjustments (quote_id, kind, label, amount, taxable) values (v_q, 'cargo', 'Envío', 10, true);
  -- 3×139 = 417 − 41.70 = 375.30 ; + 50 exento ; base = 375.30 + 10 = 385.30 ; IVA 50.09
  select * into q from quotes where id = v_q;
  assert q.taxable_base = 385.30 and q.tax_total = 50.09, 'base/iva ' || q.taxable_base || '/' || q.tax_total;
  assert q.total = 485.39, 'total ' || q.total;

  -- intentar escribir el total a mano no surte efecto
  update quotes set total = 1 where id = v_q;
  assert (select total from quotes where id = v_q) = 485.39, 'total manipulado';

  -- cambiar tasa recalcula
  update quotes set tax_rate = 0 where id = v_q;
  assert (select total from quotes where id = v_q) = 435.30, 'recalculo tasa';
  update quotes set tax_rate = 13 where id = v_q;

  -- estado solo vía RPC
  begin
    update quotes set status = 'aceptada' where id = v_q;
    assert false, 'estado cambiado sin RPC';
  exception when raise_exception then null;
  end;

  -- transición inválida
  begin
    perform change_quote_status(v_q, 'aceptada');
    assert false, 'borrador→aceptada permitido';
  exception when raise_exception then null;
  end;

  perform change_quote_status(v_q, 'enviada');
  assert (select sent_at from quotes where id = v_q) is not null, 'sent_at';
  perform change_quote_status(v_q, 'aceptada', 'OC recibida');

  -- bloqueada tras aceptar
  begin
    update quote_items set unit_price = 1 where quote_id = v_q;
    assert false, 'edición de cotización aceptada';
  exception when raise_exception then null;
  end;

  -- aceptar NO crea ni avanza pedido
  assert not exists (select 1 from orders where quote_id = v_q), 'pedido automático';

  v_o := convert_quote_to_order(v_q, true, current_date + 5, null);
  select * into q from orders where id = v_o;
  assert q.number ~ '^PR-P-\d{4}-0003$', 'número pedido ' || q.number;
  assert q.purchase_status = 'pendiente' and q.reception_status = 'pendiente'
     and q.preparation_status = 'pendiente' and q.delivery_status = 'pendiente', 'etapas iniciales';
  assert q.total = 485.39, 'total pedido';
  assert (select quote_id from orders where id = v_o) = v_q, 'relación con cotización';
  assert (select count(*) from order_items where order_id = v_o) = 2, 'líneas pedido';

  begin
    perform convert_quote_to_order(v_q);
    assert false, 'doble conversión';
  exception when raise_exception then null;
  end;

  -- etapas separadas
  begin
    update orders set delivery_status = 'entregada' where id = v_o;
    assert false, 'etapa sin RPC';
  exception when raise_exception then null;
  end;
  begin
    perform update_order_stage(v_o, 'recepcion', 'recibida');
    assert false, 'recepción antes de compra';
  exception when raise_exception then null;
  end;
  begin
    perform update_order_stage(v_o, 'entrega', 'entregada');
    assert false, 'entrega antes de preparación';
  exception when raise_exception then null;
  end;
  perform update_order_stage(v_o, 'compra', 'comprada');
  assert (select reception_status from orders where id = v_o) = 'pendiente', 'compra avanzó recepción';
  perform update_order_stage(v_o, 'recepcion', 'recibida');
  perform update_order_stage(v_o, 'preparacion', 'lista');
  begin
    perform update_order_stage(v_o, 'estado', 'cerrado');
    assert false, 'cierre sin entrega';
  exception when raise_exception then null;
  end;
  perform update_order_stage(v_o, 'entrega', 'entregada', null, null, 'Recepción del cliente');
  perform update_order_stage(v_o, 'estado', 'cerrado');
  assert (select count(*) from order_events where order_id = v_o) = 6, 'eventos pedido';

  -- no puede administrar usuarios ni configuración
  update company_settings set default_tax_rate = 99;
  assert (select default_tax_rate from company_settings) = 13, 'ops cambió configuración';
end $$;
reset role;

-- ---------- 6b. save_quote atómico ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', false);
set role authenticated;
do $$
declare v_id uuid; v_item uuid; q record;
begin
  v_id := save_quote(jsonb_build_object(
    'client_id', 'd1000000-0000-4000-8000-000000000002',
    'title', 'Prueba save_quote',
    'items', jsonb_build_array(
      jsonb_build_object('product_id', 'd4000000-0000-4000-8000-000000000001', 'description', 'Laptop', 'quantity', 2, 'unit_price', 789, 'discount_pct', 0, 'taxable', true, 'unit_cost', 640),
      jsonb_build_object('description', 'Línea personalizada', 'quantity', 1, 'unit_price', 100, 'taxable', true)
    ),
    'adjustments', jsonb_build_array(jsonb_build_object('kind', 'cargo', 'label', 'Envío', 'amount', 15, 'taxable', true))
  ));
  select * into q from quotes where id = v_id;
  -- 1578 + 100 + 15 = 1693 ; IVA 220.09 ; total 1913.09
  assert q.total = 1913.09, 'save_quote total ' || q.total;
  assert (select count(*) from quote_item_costs c join quote_items i on i.id = c.quote_item_id where i.quote_id = v_id) = 1, 'costo de línea';

  select id into v_item from quote_items where quote_id = v_id and position = 1;
  -- editar: cambiar cantidad, quitar línea personalizada y el cargo
  perform save_quote(jsonb_build_object(
    'id', v_id, 'client_id', 'd1000000-0000-4000-8000-000000000002', 'tax_rate', 13,
    'items', jsonb_build_array(jsonb_build_object('id', v_item, 'product_id', 'd4000000-0000-4000-8000-000000000001', 'description', 'Laptop', 'quantity', 3, 'unit_price', 789, 'taxable', true, 'unit_cost', 640)),
    'adjustments', '[]'::jsonb
  ));
  select * into q from quotes where id = v_id;
  assert (select count(*) from quote_items where quote_id = v_id) = 1, 'líneas tras editar';
  assert (select id from quote_items where quote_id = v_id) = v_item, 'conservó id de línea';
  assert q.total = 2674.71, 'total tras editar ' || q.total;  -- 2367 + 307.71

  -- una línea inválida revierte todo el guardado
  begin
    perform save_quote(jsonb_build_object('id', v_id, 'client_id', 'd1000000-0000-4000-8000-000000000002',
      'items', jsonb_build_array(jsonb_build_object('description', 'x', 'quantity', 0, 'unit_price', 1))));
    assert false, 'aceptó cantidad 0';
  exception when check_violation then null;
  end;
  assert (select count(*) from quote_items where quote_id = v_id) = 1, 'guardado parcial';

  -- no se puede guardar una cotización aceptada
  begin
    perform save_quote(jsonb_build_object('id', 'd5000000-0000-4000-8000-000000000004', 'client_id', 'd1000000-0000-4000-8000-000000000004'));
    assert false, 'editó aceptada';
  exception when raise_exception then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', false);
set role authenticated;
do $$ begin
  begin
    perform save_quote(jsonb_build_object('client_id', 'd1000000-0000-4000-8000-000000000002'));
    assert false, 'comercial usó save_quote';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- ---------- 6c. Cargos/deducciones por porcentaje ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', false);
set role authenticated;
do $$
declare v_id uuid; v_item uuid; q record;
begin
  -- 2 × 545 + 1 × 12.50 = 1102.50 ; 10 % descuento afecta IVA = 110.25 ; envío fijo 15 gravado
  v_id := save_quote(jsonb_build_object(
    'client_id', 'd1000000-0000-4000-8000-000000000004',
    'items', jsonb_build_array(
      jsonb_build_object('description', 'Desktop', 'quantity', 2, 'unit_price', 545, 'taxable', true),
      jsonb_build_object('description', 'Licencia', 'quantity', 1, 'unit_price', 12.50, 'taxable', true)),
    'adjustments', jsonb_build_array(
      jsonb_build_object('kind', 'deduccion', 'label', 'Descuento', 'percent', 10, 'amount', 0, 'taxable', true),
      jsonb_build_object('kind', 'cargo', 'label', 'Envío', 'amount', 15, 'taxable', true))
  ));
  select * into q from quotes where id = v_id;
  assert (select amount from quote_adjustments where quote_id = v_id and percent = 10) = 110.25, 'monto del 10 %';
  -- base = 1102.50 + 15 − 110.25 = 1007.25 ; IVA 130.94 ; total 1007.25 + 130.94 = 1138.19
  assert q.taxable_base = 1007.25, 'base % ' || q.taxable_base;
  assert q.total = 1138.19, 'total % ' || q.total;

  -- cambiar cantidades → el monto del % se recalcula solo
  select id into v_item from quote_items where quote_id = v_id and description = 'Desktop';
  update quote_items set quantity = 4 where id = v_item;
  assert (select amount from quote_adjustments where quote_id = v_id and percent = 10) = 219.25, 'recalculo del %';

  -- porcentaje inválido
  begin
    perform save_quote(jsonb_build_object('id', v_id, 'client_id', 'd1000000-0000-4000-8000-000000000004',
      'items', jsonb_build_array(jsonb_build_object('id', v_item, 'description', 'Desktop', 'quantity', 1, 'unit_price', 545)),
      'adjustments', jsonb_build_array(jsonb_build_object('kind', 'deduccion', 'label', 'X', 'percent', 150))));
    assert false, 'aceptó 150 %';
  exception when check_violation then null;
  end;

  -- duplicar conserva el %
  v_item := duplicate_quote(v_id);
  assert (select count(*) from quote_adjustments where quote_id = v_item and percent = 10) = 1, 'duplicar copia el %';
end $$;
reset role;

-- ---------- 6d. Fotos de productos ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', false);
set role authenticated;
do $$
declare v_id uuid; v_dup uuid;
begin
  assert (select count(*) from products where is_demo and image_url like '/demo/%.jpg') = 8, 'fotos demo';
  -- por defecto se incluyen fotos
  v_id := save_quote(jsonb_build_object('client_id', 'd1000000-0000-4000-8000-000000000004',
    'items', jsonb_build_array(jsonb_build_object('product_id', 'd4000000-0000-4000-8000-000000000001', 'description', 'Laptop', 'quantity', 1, 'unit_price', 789))));
  assert (select show_images from v_quotes where id = v_id), 'show_images por defecto';
  -- se puede apagar al editar, y un save sin la clave no lo cambia
  perform save_quote(jsonb_build_object('id', v_id, 'client_id', 'd1000000-0000-4000-8000-000000000004', 'show_images', false,
    'items', jsonb_build_array(jsonb_build_object('description', 'Laptop', 'quantity', 1, 'unit_price', 789))));
  assert not (select show_images from quotes where id = v_id), 'apagar fotos';
  perform save_quote(jsonb_build_object('id', v_id, 'client_id', 'd1000000-0000-4000-8000-000000000004',
    'items', jsonb_build_array(jsonb_build_object('description', 'Laptop', 'quantity', 1, 'unit_price', 789))));
  assert not (select show_images from quotes where id = v_id), 'save sin la clave conserva';
  v_dup := duplicate_quote(v_id);
  assert not (select show_images from quotes where id = v_dup), 'duplicar conserva fotos=no';
end $$;
reset role;

-- ---------- 7. Admin ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', false);
set role authenticated;
do $$ begin
  assert (select count(*) from audit_log) > 0, 'admin no ve auditoría';
  update company_settings set phone = '0000-0000';
  assert (select phone from company_settings) = '0000-0000', 'admin no editó configuración';
  update document_sequences set prefix = 'PR-COT' where doc_type = 'quote';
  begin
    update document_sequences set last_value = 0 where doc_type = 'quote';
    assert false, 'reinició correlativo';
  exception when insufficient_privilege then null;
  end;
  update document_sequences set prefix = 'PR-Q' where doc_type = 'quote';
  begin
    delete from user_roles where user_id = auth.uid() and role = 'admin';
    assert false, 'borró el último admin';
  exception when raise_exception then null;
  end;
  begin
    update quotes set number = 'X' where id = 'd5000000-0000-4000-8000-000000000001';
    assert false, 'número editable';
  exception when raise_exception then null;
  end;
end $$;
reset role;

-- ---------- 7b. Eliminar sin perder historial ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', false);
set role authenticated;
do $$ begin
  assert not (delete_check('product', 'd4000000-0000-4000-8000-000000000001') ->> 'ok')::boolean, 'comercial no puede eliminar';
  begin
    perform delete_record('client', 'd1000000-0000-4000-8000-000000000001');
    assert false, 'comercial eliminó';
  exception when raise_exception then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', false);
set role authenticated;
do $$
declare v_client uuid; v_prod uuid; v_sup uuid; v_q uuid; v_sent uuid;
begin
  -- con historial: no se borra
  assert not (delete_check('client', 'd1000000-0000-4000-8000-000000000001') ->> 'ok')::boolean, 'cliente con cotizaciones';
  begin perform delete_record('client', 'd1000000-0000-4000-8000-000000000001'); assert false, 'borró cliente con historial';
  exception when raise_exception then null; end;
  assert not (delete_check('product', 'd4000000-0000-4000-8000-000000000001') ->> 'ok')::boolean, 'producto usado';
  -- sin historial: se borra con lo suyo
  insert into clients (name) values ('Borrar Test') returning id into v_client;
  insert into contacts (client_id, full_name) values (v_client, 'Contacto X');
  assert (delete_check('client', v_client) ->> 'ok')::boolean, 'cliente sin historial';
  perform delete_record('client', v_client);
  assert not exists (select 1 from clients where id = v_client), 'cliente borrado';
  assert not exists (select 1 from contacts where client_id = v_client), 'contactos borrados';
  insert into products (sku, name, sale_price) values ('DEL-1', 'Borrar', 1) returning id into v_prod;
  perform delete_record('product', v_prod);
  assert not exists (select 1 from products where id = v_prod), 'producto borrado';
  insert into suppliers (name) values ('Prov borrar') returning id into v_sup;
  perform delete_record('supplier', v_sup);
  assert not exists (select 1 from suppliers where id = v_sup), 'proveedor borrado';
  -- cotizaciones: solo borrador
  v_q := save_quote(jsonb_build_object('client_id', 'd1000000-0000-4000-8000-000000000004',
    'items', jsonb_build_array(jsonb_build_object('description', 'X', 'quantity', 1, 'unit_price', 1))));
  perform delete_record('quote', v_q);
  assert not exists (select 1 from quotes where id = v_q), 'borrador borrado';
  select id into v_sent from quotes where status = 'enviada' limit 1;
  begin perform delete_record('quote', v_sent); assert false, 'borró una enviada';
  exception when raise_exception then null; end;
  assert exists (select 1 from audit_log where action = 'delete' and table_name = 'clients'), 'auditoría del borrado';
end $$;
reset role;

-- ---------- 7c. Órdenes de compra: IVA y recepción por línea ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', false);
set role authenticated;
do $$ begin
  assert (select count(*) from purchase_orders) = 0, 'comercial no ve OC';
  begin
    perform receive_purchase_order('d8000000-0000-4000-8000-000000000001', '[]');
    assert false, 'comercial recibió OC';
  exception when raise_exception then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', false);
set role authenticated;
do $$
declare v_po uuid; i1 uuid; i2 uuid; r purchase_orders;
begin
  insert into purchase_orders (number, supplier_id, tax_rate, payment_terms) values ('', 'd3000000-0000-4000-8000-000000000001', 13, 'Crédito 30 días') returning id into v_po;
  insert into purchase_order_items (purchase_order_id, description, quantity, unit_cost) values (v_po, 'A', 10, 100) returning id into i1;
  insert into purchase_order_items (purchase_order_id, description, quantity, unit_cost) values (v_po, 'B', 2, 50.5) returning id into i2;
  select * into r from purchase_orders where id = v_po;
  assert r.number like 'PR-OC-%', 'número OC';
  assert r.total_cost = 1101 and r.tax_total = 143.13 and r.grand_total = 1244.13, format('totales OC %s %s %s', r.total_cost, r.tax_total, r.grand_total);
  -- en borrador no se recibe
  begin
    perform receive_purchase_order(v_po, jsonb_build_array(jsonb_build_object('id', i1, 'quantity_received', 1)));
    assert false, 'recibió en borrador';
  exception when raise_exception then null;
  end;
  update purchase_orders set status = 'enviada', ordered_at = current_date where id = v_po;
  r := receive_purchase_order(v_po, jsonb_build_array(jsonb_build_object('id', i1, 'quantity_received', 8)));
  assert r.status = 'recibida_parcial' and r.received_at is null, 'parcial';
  -- no se puede recibir más de lo pedido (se topa)
  r := receive_purchase_order(v_po, jsonb_build_array(jsonb_build_object('id', i1, 'quantity_received', 99), jsonb_build_object('id', i2, 'quantity_received', 2)));
  assert r.status = 'recibida' and r.received_at is not null, 'completa';
  assert (select quantity_received from purchase_order_items where id = i1) = 10, 'tope a lo pedido';
  -- volver a 0 regresa a enviada
  r := receive_purchase_order(v_po, jsonb_build_array(jsonb_build_object('id', i1, 'quantity_received', 0), jsonb_build_object('id', i2, 'quantity_received', 0)));
  assert r.status = 'enviada', 'deshacer recepción';
  -- IVA 0
  update purchase_orders set tax_rate = 0 where id = v_po;
  assert (select grand_total from purchase_orders where id = v_po) = 1101, 'sin IVA';
end $$;
reset role;

-- ---------- 8. Numeración bajo muchas inserciones ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', false);
set role authenticated;
do $$ begin
  for i in 1..50 loop
    insert into quotes (number, client_id) values ('', 'd1000000-0000-4000-8000-000000000001');
  end loop;
  assert (select count(*) = count(distinct number) from quotes), 'números duplicados';
end $$;
reset role;

select 'TODAS LAS PRUEBAS PASARON' as result;
