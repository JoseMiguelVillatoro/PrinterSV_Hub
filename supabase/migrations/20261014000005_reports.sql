-- =====================================================================
-- Printer Business Hub — 0005: vistas y métricas (todas con RLS del invocador)
-- =====================================================================

-- Historial de precios cotizados: producto/servicio × cliente × fecha × cotización
create view public.v_price_history with (security_invoker = true) as
select
  qi.id              as quote_item_id,
  qi.product_id,
  coalesce(p.sku, qi.sku) as sku,
  coalesce(p.name, qi.description) as product_name,
  qi.description,
  qi.kind,
  qi.product_id is null as is_custom,
  q.id               as quote_id,
  q.number           as quote_number,
  q.status           as quote_status,
  q.issue_date,
  c.id               as client_id,
  c.name             as client_name,
  qi.quantity,
  qi.unit_price,
  qi.discount_pct,
  round(qi.line_total / qi.quantity, 2) as effective_unit_price,
  q.currency,
  q.is_demo
from public.quote_items qi
join public.quotes q  on q.id = qi.quote_id
join public.clients c on c.id = q.client_id
left join public.products p on p.id = qi.product_id;

-- Listado de cotizaciones con datos de cliente y vencimiento efectivo
create view public.v_quotes with (security_invoker = true) as
select
  q.*,
  c.name       as client_name,
  ct.full_name as contact_name,
  pr.full_name as owner_name,
  (q.status in ('enviada', 'negociacion') and q.valid_until < (now() at time zone 'America/El_Salvador')::date) as is_overdue_validity,
  (q.next_action_date is not null and q.next_action_date < (now() at time zone 'America/El_Salvador')::date
     and q.status in ('borrador', 'pendiente_envio', 'enviada', 'negociacion', 'vencida')) as is_followup_late,
  o.id         as order_id,
  o.number     as order_number
from public.quotes q
join public.clients c on c.id = q.client_id
left join public.contacts ct on ct.id = q.contact_id
left join public.profiles pr on pr.id = q.owner_id
left join public.orders o on o.quote_id = q.id;

create view public.v_orders with (security_invoker = true) as
select
  o.*,
  c.name   as client_name,
  q.number as quote_number,
  q.requested_at,
  q.accepted_at,
  pr.full_name as owner_name
from public.orders o
join public.clients c on c.id = o.client_id
join public.quotes q on q.id = o.quote_id
left join public.profiles pr on pr.id = o.owner_id;

-- Margen por cotización (solo filas con costo; quote_item_costs está restringida
-- por RLS, así que un rol comercial verá costo nulo).
create view public.v_quote_margins with (security_invoker = true) as
select
  q.id as quote_id,
  q.number,
  q.status,
  q.issue_date,
  c.name as client_name,
  sum(qi.line_total) as revenue,
  sum(round(qi.quantity * qc.unit_cost, 2)) as cost,
  sum(qi.line_total) - sum(round(qi.quantity * qc.unit_cost, 2)) as margin,
  case when sum(qi.line_total) > 0
       then round((sum(qi.line_total) - sum(round(qi.quantity * qc.unit_cost, 2))) / sum(qi.line_total) * 100, 1)
  end as margin_pct,
  count(qi.id) filter (where qc.unit_cost is null) as lines_without_cost,
  q.is_demo
from public.quotes q
join public.clients c on c.id = q.client_id
join public.quote_items qi on qi.quote_id = q.id
left join public.quote_item_costs qc on qc.quote_item_id = qi.id
where public.can_see_costs()
group by q.id, c.name;

-- ---------------------------------------------------------------------
-- Métricas del dashboard, calculadas sobre registros reales.
-- Rango de fechas en hora de El Salvador.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_metrics(
  p_from date default null,
  p_to   date default null,
  p_include_demo boolean default true
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/El_Salvador')::date;
  v_from  date := coalesce(p_from, v_today - 29);
  v_to    date := coalesce(p_to, v_today);
  v       jsonb;
begin
  if not public.is_staff() then
    raise exception 'No autorizado';
  end if;

  with
  qs as (
    select * from public.quotes
     where (p_include_demo or not is_demo)
  ),
  q_range as (
    select * from qs where issue_date between v_from and v_to
  ),
  decided as (
    select * from q_range where status in ('aceptada', 'rechazada', 'vencida')
  ),
  ords as (
    select o.*, q.requested_at, q.sent_at as q_sent_at, q.accepted_at as q_accepted_at
      from public.orders o join public.quotes q on q.id = o.quote_id
     where (p_include_demo or not o.is_demo)
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'clients', jsonb_build_object(
      'total',      (select count(*) from public.clients where (p_include_demo or not is_demo)),
      'prospects',  (select count(*) from public.clients where status = 'prospecto' and (p_include_demo or not is_demo)),
      'active',     (select count(*) from public.clients where status = 'activo' and (p_include_demo or not is_demo)),
      'new_in_range', (select count(*) from public.clients
                        where (created_at at time zone 'America/El_Salvador')::date between v_from and v_to
                          and (p_include_demo or not is_demo))
    ),
    'visits', jsonb_build_object(
      'done_in_range', (select count(*) from public.visits
                         where status = 'realizada' and (p_include_demo or not is_demo)
                           and (scheduled_at at time zone 'America/El_Salvador')::date between v_from and v_to),
      'upcoming_7d',   (select count(*) from public.visits
                         where status = 'programada' and (p_include_demo or not is_demo)
                           and (scheduled_at at time zone 'America/El_Salvador')::date between v_today and v_today + 7)
    ),
    'quotes', jsonb_build_object(
      'count_in_range',  (select count(*) from q_range where status not in ('borrador', 'cancelada')),
      'amount_in_range', (select coalesce(sum(total), 0) from q_range where status not in ('borrador', 'cancelada')),
      'accepted_amount_in_range', (select coalesce(sum(total), 0) from q_range where status = 'aceptada'),
      'open_pipeline',   (select coalesce(sum(total), 0) from qs where status in ('pendiente_envio', 'enviada', 'negociacion')),
      'by_status', (
        select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n, 'amount', s.amount) order by s.ord), '[]'::jsonb)
          from (
            select e.status, e.ord, count(q.id) as n, coalesce(sum(q.total), 0) as amount
              from unnest(enum_range(null::public.quote_status)) with ordinality as e(status, ord)
              left join q_range q on q.status = e.status
             group by e.status, e.ord
          ) s
      ),
      'conversion_rate', (
        select case when count(*) = 0 then null
                    else round(count(*) filter (where status = 'aceptada')::numeric / count(*) * 100, 1) end
          from decided
      ),
      'decided_count', (select count(*) from decided),
      'followups_late', (
        select count(*) from qs
         where next_action_date < v_today
           and status in ('borrador', 'pendiente_envio', 'enviada', 'negociacion', 'vencida')
      ),
      'validity_expired_open', (
        select count(*) from qs where status in ('enviada', 'negociacion') and valid_until < v_today
      )
    ),
    'tasks', jsonb_build_object(
      'overdue',   (select count(*) from public.tasks where status = 'pendiente' and due_date < v_today and (p_include_demo or not is_demo)),
      'due_today', (select count(*) from public.tasks where status = 'pendiente' and due_date = v_today and (p_include_demo or not is_demo))
    ),
    'orders', jsonb_build_object(
      'open',                (select count(*) from ords where status = 'abierto'),
      'created_in_range',    (select count(*) from ords where status <> 'cancelado'
                               and (created_at at time zone 'America/El_Salvador')::date between v_from and v_to),
      'amount_in_range',     (select coalesce(sum(total), 0) from ords where status <> 'cancelado'
                               and (created_at at time zone 'America/El_Salvador')::date between v_from and v_to),
      'pending_purchase',    (select count(*) from ords where status = 'abierto' and requires_purchase and purchase_status in ('pendiente', 'solicitada')),
      'pending_reception',   (select count(*) from ords where status = 'abierto' and requires_purchase and purchase_status = 'comprada' and reception_status <> 'recibida'),
      'pending_preparation', (select count(*) from ords where status = 'abierto' and preparation_status <> 'lista'),
      'pending_delivery',    (select count(*) from ords where status = 'abierto' and delivery_status <> 'entregada'),
      'delivered_in_range',  (select count(*) from ords where delivered_at is not null
                               and (delivered_at at time zone 'America/El_Salvador')::date between v_from and v_to)
    ),
    -- Tiempos promedio en días (con decimales). Null si no hay datos.
    'times', jsonb_build_object(
      'request_to_sent_days', (
        select round(avg(extract(epoch from (sent_at - requested_at)) / 86400)::numeric, 1)
          from qs where sent_at is not null and sent_at >= requested_at
      ),
      'sent_to_accepted_days', (
        select round(avg(extract(epoch from (accepted_at - sent_at)) / 86400)::numeric, 1)
          from qs where accepted_at is not null and sent_at is not null and accepted_at >= sent_at
      ),
      'accepted_to_delivered_days', (
        select round(avg(extract(epoch from (delivered_at - q_accepted_at)) / 86400)::numeric, 1)
          from ords where delivered_at is not null and q_accepted_at is not null
      ),
      'request_to_delivered_days', (
        select round(avg(extract(epoch from (delivered_at - requested_at)) / 86400)::numeric, 1)
          from ords where delivered_at is not null
      )
    ),
    -- Monto cotizado por mes (últimos 6 meses, incluido el actual)
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'quoted', m.quoted, 'accepted', m.accepted) order by m.month), '[]'::jsonb)
        from (
          select gs.month,
                 coalesce(sum(q.total) filter (where q.status not in ('borrador', 'cancelada')), 0) as quoted,
                 coalesce(sum(q.total) filter (where q.status = 'aceptada'), 0) as accepted
            from generate_series(date_trunc('month', v_today) - interval '5 months', date_trunc('month', v_today), interval '1 month') as gs(month)
            left join qs q on date_trunc('month', q.issue_date) = gs.month
           group by gs.month
        ) m
    )
  ) into v;

  return v;
end;
$$;

grant select on public.v_price_history, public.v_quotes, public.v_orders, public.v_quote_margins to authenticated;
revoke all on public.v_price_history, public.v_quotes, public.v_orders, public.v_quote_margins from anon;
