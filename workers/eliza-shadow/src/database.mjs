import sqlPlugin, { createDatabaseAdapter } from "@elizaos/plugin-sql";
import { logger } from "@elizaos/core";
import { WorkerError } from "./contract.mjs";
import { SqlJobStore } from "./store.mjs";

export const REQUIRED_RUNTIME_TABLES = [
  "agents",
  "worlds",
  "entities",
  "rooms",
  "participants",
  "logs",
  "eliza_shadow_jobs",
];

const applicationFunctionsQuery = `SELECT p.prokind AS kind,
  format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) AS signature
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
      WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`;

export function validatePostgresUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WorkerError("invalid_postgres_url", 500);
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    url.searchParams.getAll("sslmode").length !== 1 ||
    url.searchParams.get("sslmode") !== "verify-full" ||
    url.searchParams.has("ssl") ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  ) {
    throw new WorkerError("postgres_verified_tls_required", 500);
  }
  return value;
}

export function assertDedicatedDatabaseConfiguration() {
  if (process.env.ENABLE_DATA_ISOLATION === "true") {
    throw new WorkerError("eliza_data_isolation_not_supported", 500);
  }
}

export function configurePostgresConnection(
  connection,
  { bootstrap = false } = {},
) {
  if (!connection.options)
    throw new WorkerError("postgres_pool_configuration_unavailable", 500);
  Object.assign(connection.options, {
    // The upstream migrator sends BEGIN/COMMIT and session advisory locks via
    // pool.query rather than one checked-out client. Keep its one session alive.
    max: bootstrap ? 1 : 2,
    min: 0,
    idleTimeoutMillis: bootstrap ? 0 : 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: bootstrap ? 60_000 : 15_000,
    query_timeout: bootstrap ? 65_000 : 20_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 15_000,
    application_name: bootstrap
      ? "symbaiex-eliza-shadow-bootstrap"
      : "symbaiex-eliza-shadow",
  });
}

export async function assertEmptyBootstrapDatabase(connection) {
  const { rows } = await connection.query(
    "SELECT schemaname,tablename,rowsecurity FROM pg_catalog.pg_tables WHERE schemaname IN ('public','migrations')",
  );
  if (rows.some((row) => row.schemaname === "public" && row.rowsecurity)) {
    throw new WorkerError("bootstrap_existing_rls", 500);
  }
  if (rows.some((row) => row.schemaname === "public")) {
    throw new WorkerError("bootstrap_public_schema_not_empty", 500);
  }
  if (rows.some((row) => row.schemaname === "migrations")) {
    throw new WorkerError("bootstrap_existing_migration_metadata", 500);
  }
  const { rows: functions } = await connection.query(applicationFunctionsQuery);
  if (functions.length)
    throw new WorkerError("bootstrap_existing_public_functions", 500);
}

export async function verifyRequiredRuntimeTables(connection) {
  const { rows } = await connection.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])",
    [REQUIRED_RUNTIME_TABLES],
  );
  const found = new Set(rows.map((row) => row.tablename));
  if (REQUIRED_RUNTIME_TABLES.some((table) => !found.has(table))) {
    throw new WorkerError("postgres_bootstrap_required", 500);
  }
  // Verify the current ledger contract and SELECT privileges without DDL.
  await connection.query(`SELECT job_id,input_hash,request_hash,state,result,result_expires_at,error_code,created_at,updated_at
    FROM public.eliza_shadow_jobs LIMIT 0`);
}

export async function verifyRuntimeDatabaseRole(connection) {
  const { rows } =
    await connection.query(`SELECT current_user AS role,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,
    has_database_privilege(current_user,current_database(),'CREATE') AS can_create_schema,
    has_schema_privilege(current_user,'public','CREATE') AS can_create_public
    FROM pg_catalog.pg_roles WHERE rolname=current_user`);
  const role = rows[0];
  const reserved = new Set([
    "postgres",
    "supabase_admin",
    "anon",
    "authenticated",
    "authenticator",
    "service_role",
    "supabase_auth_admin",
    "supabase_storage_admin",
    "dashboard_user",
  ]);
  if (
    !role ||
    typeof role.role !== "string" ||
    reserved.has(role.role) ||
    role.role.startsWith("pg_") ||
    [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolbypassrls",
      "can_create_schema",
      "can_create_public",
    ].some((key) => role[key] !== false)
  ) {
    throw new WorkerError("postgres_restricted_runtime_role_required", 500);
  }
}

export async function initializeRuntimeDatabase(adapter, { postgresUrl } = {}) {
  const connection = await adapter.getConnection();
  if (postgresUrl) {
    validatePostgresUrl(postgresUrl);
    assertDedicatedDatabaseConfiguration();
    configurePostgresConnection(connection);
    await verifyRuntimeDatabaseRole(connection);
    await verifyRequiredRuntimeTables(connection);
  } else {
    // PGlite is explicitly local/test-only and still bootstraps its own schema.
    await adapter.runPluginMigrations(
      [{ name: sqlPlugin.name, schema: sqlPlugin.schema }],
      { verbose: false, force: false },
    );
  }
  const store = new SqlJobStore(connection);
  if (postgresUrl) await store.isReady();
  else await store.initialize();
  return store;
}

export async function bootstrapPostgres({
  postgresUrl,
  adapterFactory = createDatabaseAdapter,
}) {
  for (const method of [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
    "success",
    "progress",
    "log",
  ])
    logger[method] = () => {};
  validatePostgresUrl(postgresUrl);
  assertDedicatedDatabaseConfiguration();
  if (process.env.ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS === "true") {
    throw new WorkerError("bootstrap_destructive_migrations_not_allowed", 500);
  }
  // Run in a fresh, isolated helper process. The upstream migrator detects
  // PostgreSQL from this variable, not the adapter's constructor configuration.
  const priorUrl = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = postgresUrl;
  let adapter;
  try {
    adapter = adapterFactory(
      { postgresUrl },
      "f14a35b2-4023-0819-8d1b-037e98240d9c",
    );
    const connection = await adapter.getConnection();
    configurePostgresConnection(connection, { bootstrap: true });
    await assertEmptyBootstrapDatabase(connection);
    // Nothing before this guard performs DDL or invokes Eliza's migration
    // preflight, whose legacy RLS cleanup is unsafe in shared public schemas.
    await adapter.runPluginMigrations(
      [{ name: sqlPlugin.name, schema: sqlPlugin.schema }],
      { verbose: false, force: false, dryRun: false },
    );
    const store = new SqlJobStore(connection);
    await store.initialize();
    await verifyRequiredRuntimeTables(connection);
    // Supabase can grant Data API roles table rights by default. These are
    // private service tables; remove only grants on tables created above.
    const { rows: tables } = await connection.query(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'",
    );
    const qualified = tables
      .map((row) => `public."${row.tablename.replaceAll('"', '""')}"`)
      .join(",");
    await connection.query(
      `REVOKE ALL PRIVILEGES ON TABLE ${qualified} FROM PUBLIC`,
    );
    const { rows: roles } = await connection.query(
      "SELECT rolname FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[])",
      [["anon", "authenticated", "service_role"]],
    );
    for (const role of roles) {
      await connection.query(
        `REVOKE ALL PRIVILEGES ON TABLE ${qualified} FROM "${role.rolname.replaceAll('"', '""')}"`,
      );
    }
    // New application routines must not expose private tables through callable
    // SECURITY DEFINER RPCs. Extension-owned routines are platform functionality
    // and are deliberately not altered. Existing application routines failed
    // the preflight above, so all routines here belong to this bootstrap.
    const { rows: functions } = await connection.query(
      applicationFunctionsQuery,
    );
    for (const routine of functions) {
      const kind = routine.kind === "p" ? "PROCEDURE" : "FUNCTION";
      await connection.query(
        `REVOKE ALL PRIVILEGES ON ${kind} ${routine.signature} FROM PUBLIC`,
      );
      for (const role of roles) {
        await connection.query(
          `REVOKE ALL PRIVILEGES ON ${kind} ${routine.signature} FROM "${role.rolname.replaceAll('"', '""')}"`,
        );
      }
    }
    return { ok: true, runtimeVersion: "1.7.2", tablesCreated: tables.length };
  } finally {
    if (adapter) await adapter.close();
    if (priorUrl === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = priorUrl;
  }
}
