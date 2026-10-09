select cron.schedule(
  'materialise-runs',
  '10 0 * * *',
  $cron$
    -- The named Vault secret contains the named "materialise" secret API key.
    -- A missing or empty Vault value emits no request, leaving no public path.
    select net.http_post(
      url := 'https://orma-api.nryn.dev/functions/v1/materialise',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', materialise_key.decrypted_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    ) as request_id
    from vault.decrypted_secrets as materialise_key
    where materialise_key.name = 'ORMA_MATERIALISE_SECRET_KEY'
      and nullif(materialise_key.decrypted_secret, '') is not null;
  $cron$
);
