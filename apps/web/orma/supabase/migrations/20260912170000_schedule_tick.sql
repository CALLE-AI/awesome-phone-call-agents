-- T2.4: activate the dispatcher only after it can advance each claimed run.
-- The shared named Vault key is read at execution time. It never appears in
-- the migration, the cron command, or a request when the value is absent.
select cron.schedule(
  'tick-runs',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://orma-api.nryn.dev/functions/v1/tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', scheduler_key.decrypted_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    ) as request_id
    from vault.decrypted_secrets as scheduler_key
    where scheduler_key.name = 'ORMA_MATERIALISE_SECRET_KEY'
      and nullif(scheduler_key.decrypted_secret, '') is not null;
  $cron$
);
