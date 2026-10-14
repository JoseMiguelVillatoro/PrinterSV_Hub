\set ON_ERROR_STOP 1
select public.purge_demo_data() as purged;
do $$ begin
  assert (select count(*) from clients) = 0 and (select count(*) from quotes) = 0 and (select count(*) from orders) = 0
     and (select count(*) from products) = 0 and (select count(*) from suppliers) = 0, 'quedaron datos demo';
  assert (select count(*) from seed_runs) = 1, 'seed_runs se conserva (no se vuelve a sembrar)';
end $$;
select public.apply_demo_seed() as reseed_attempt;  -- debe decir skipped
select 'PURGE OK' as result;
