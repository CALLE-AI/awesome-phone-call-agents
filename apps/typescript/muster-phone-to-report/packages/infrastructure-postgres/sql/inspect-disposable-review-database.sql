SELECT d.oid::text AS database_oid,
       d.datname AS database_name,
       shobj_description(d.oid, 'pg_database') AS ownership_comment,
       c.system_identifier::text AS cluster_system_identifier
  FROM pg_database AS d
 CROSS JOIN pg_control_system() AS c
 WHERE d.datname = $1
   AND d.datistemplate = FALSE
   AND d.datallowconn = TRUE
