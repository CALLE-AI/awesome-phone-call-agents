-- T7.3 schedules the weekly analysis report. It reuses the materialise job's
-- named Vault secret so one scheduler credential serves both crons. The two
-- minute timeout covers prose generation, which is the slow stage.

select cron.schedule(
  'analysis-report',
  '20 6 * * 1',
  $cron$
    -- The named Vault secret contains the named "materialise" secret API key.
    -- A missing or empty Vault value emits no request, leaving no public path.
    select net.http_post(
      url := 'https://orma-api.nryn.dev/functions/v1/analysis',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', materialise_key.decrypted_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id
    from vault.decrypted_secrets as materialise_key
    where materialise_key.name = 'ORMA_MATERIALISE_SECRET_KEY'
      and nullif(materialise_key.decrypted_secret, '') is not null;
  $cron$
);
