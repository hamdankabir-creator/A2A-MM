-- Run once after installing pg_cron + pg_net and adding these Vault secrets:
-- heimdall_supabase_url, heimdall_worker_secret. Never paste real secrets into Git.
-- Supabase supports intervals in seconds. Two invocations per tick allow small-pilot throughput.
select cron.schedule('heimdall-interview-worker', '10 seconds', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='heimdall_supabase_url') || '/functions/v1/customer-interview-worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='heimdall_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  ) from generate_series(1,2);
$$);
