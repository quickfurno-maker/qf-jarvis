-- LOCAL DEVELOPMENT ONLY.
--
-- Runs once, on an empty volume, when the development Compose database first boots.
-- It is not production configuration and creates no production credential.
--
-- Why a second database rather than a second schema: the integration tests DROP and
-- recreate the `public` schema on every run, so they need a database that a developer is
-- never tempted to keep anything in. `qf_jarvis_dev` is the one you can experiment in;
-- `qf_jarvis_test` is the one the test suite is free to destroy.
--
-- The test-database guards in database-test-utils.ts refuse to run against any database
-- whose name does not identify it as a test database — which is why this one is named
-- the way it is.

CREATE DATABASE qf_jarvis_test OWNER qf_jarvis_dev;

COMMENT ON DATABASE qf_jarvis_test IS
  'Destroyed and recreated by the integration test suite on every run. Keep nothing here.';
