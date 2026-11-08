\set ON_ERROR_STOP on

-- Run as a PostgreSQL superuser with:
--   psql --set=replication_password='<generated secret>' \
--        --set=app_role='<runtime DB role>' -f provision-replication.sql
-- The password is supplied by the operator and never stored in Git.
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vse_replication') THEN
    CREATE ROLE vse_replication WITH LOGIN REPLICATION;
  END IF;
END
$block$;
ALTER ROLE vse_replication PASSWORD :'replication_password';
REVOKE ALL ON DATABASE :DBNAME FROM vse_replication;
GRANT pg_monitor TO :"app_role";

SELECT pg_create_physical_replication_slot('vse_backup', true, false)
WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'vse_backup');
