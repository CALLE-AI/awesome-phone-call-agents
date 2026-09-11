SELECT 1 FROM pg_database WHERE datname = $1 OR oid = $2::oid
