\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'anisha_memory_cert' OR inet_server_addr()::text <> '127.0.0.1'
     OR inet_server_port() <> 55439 THEN
    RAISE EXCEPTION 'CERT ONLY: requires disposable 127.0.0.1:55439/anisha_memory_cert';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.vendors(id uuid primary key);
