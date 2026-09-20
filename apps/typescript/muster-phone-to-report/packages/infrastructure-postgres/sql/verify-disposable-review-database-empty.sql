SELECT 1
  FROM information_schema.tables
 WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
 LIMIT 1
