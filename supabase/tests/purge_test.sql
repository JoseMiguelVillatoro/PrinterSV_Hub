\set ON_ERROR_STOP 1
select public.purge_demo_data() as purged;
do $$ begin
  assert (select count(*) from clients) = 0 and (select count(*) from quotes) = 0 and (select count(*) from orders) = 0
     and (select count(*) from products) = 0 and (select count(*) from suppliers) = 0, 'quedaron datos demo';
  assert (select count(*) from seed_runs) = 2, 'seed_runs se conserva (no se vuelve a sembrar)';
end $$;
select public.apply_demo_seed() as reseed_attempt;  -- debe decir skipped
\i migrations/20261015000013_demo_map_clients.sql
do $$ begin assert (select count(*) from clients) = 0, 'el mapa demo no reaparece tras borrar'; end $$;
select 'PURGE OK' as result;
