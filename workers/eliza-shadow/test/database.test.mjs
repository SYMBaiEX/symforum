import assert from "node:assert/strict";
import { test } from "node:test";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parsePostgresUrl } from "pg-connection-string";
import {
  REQUIRED_RUNTIME_TABLES,
  assertEmptyBootstrapDatabase,
  bootstrapPostgres,
  configurePostgresConnection,
  initializeRuntimeDatabase,
  validatePostgresUrl,
  verifyRuntimeDatabaseRole,
} from "../src/database.mjs";

const url =
  "postgresql://shadow_worker:placeholder@db.example.invalid:5432/postgres?sslmode=verify-full";
const restrictedRole = {
  role: "eliza_shadow_runtime",
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
  rolbypassrls: false,
  can_create_schema: false,
  can_create_public: false,
};

function fakeConnection({
  role = restrictedRole,
  tables = REQUIRED_RUNTIME_TABLES,
  inventory = [],
  functions = [],
} = {}) {
  const queries = [];
  return {
    options: {},
    queries,
    async query(sql) {
      queries.push(sql);
      assert.match(
        sql.trim(),
        /^SELECT\b/i,
        "runtime/guard may issue SELECT only",
      );
      if (sql.includes("current_user AS role")) return { rows: [role] };
      if (sql.includes("schemaname IN")) return { rows: inventory };
      if (sql.includes("FROM pg_catalog.pg_proc")) return { rows: functions };
      if (sql.includes("tablename=ANY"))
        return { rows: tables.map((tablename) => ({ tablename })) };
      return { rows: [] };
    },
  };
}

test("PostgreSQL URLs require explicit verify-full TLS and never include credentials in errors", () => {
  assert.equal(validatePostgresUrl(url), url);
  for (const input of [
    url.replace("?sslmode=verify-full", ""),
    url.replace("verify-full", "require"),
    url.replace("verify-full", "no-verify"),
    `${url}&sslmode=no-verify`,
    `${url}&ssl=0`,
    "invalid placeholder credential",
  ]) {
    assert.throws(
      () => validatePostgresUrl(input),
      (error) => !error.message.includes("placeholder"),
    );
  }
});

test("bootstrap guard refuses existing public tables, RLS, and migration metadata before any migration/DDL", async () => {
  const cases = [
    {
      row: {
        schemaname: "public",
        tablename: "unrelated_app",
        rowsecurity: false,
      },
      code: "bootstrap_public_schema_not_empty",
    },
    {
      row: {
        schemaname: "public",
        tablename: "private_app",
        rowsecurity: true,
      },
      code: "bootstrap_existing_rls",
    },
    {
      row: {
        schemaname: "migrations",
        tablename: "_migrations",
        rowsecurity: false,
      },
      code: "bootstrap_existing_migration_metadata",
    },
  ];
  for (const { row, code } of cases) {
    const connection = fakeConnection({ inventory: [row] });
    let migrations = 0;
    let closed = 0;
    await assert.rejects(
      bootstrapPostgres({
        postgresUrl: url,
        adapterFactory: () => ({
          getConnection: async () => connection,
          runPluginMigrations: async () => {
            migrations++;
          },
          close: async () => {
            closed++;
          },
        }),
      }),
      (error) => error.code === code,
    );
    assert.equal(migrations, 0);
    assert.equal(closed, 1);
    assert.equal(connection.queries.length, 1);
  }
  await assertEmptyBootstrapDatabase(fakeConnection());
  await assert.rejects(
    assertEmptyBootstrapDatabase(
      fakeConnection({
        functions: [{ kind: "f", signature: "public.existing_app_rpc()" }],
      }),
    ),
    /bootstrap_existing_public_functions/,
  );
});

test("official Supabase CA is pinned and loaded by pg with verify-full, without a network connection", () => {
  const certificatePath = fileURLToPath(
    new URL("../certs/supabase-root-2021.crt", import.meta.url),
  );
  const pem = readFileSync(certificatePath, "utf8");
  const certificate = new X509Certificate(pem);
  assert.equal(certificate.ca, true);
  assert.equal(
    certificate.fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );
  assert.match(certificate.subject, /CN=Supabase Root 2021 CA/);
  const parsed = new URL(url);
  parsed.searchParams.set("sslrootcert", certificatePath);
  validatePostgresUrl(parsed.toString());
  const config = parsePostgresUrl(parsed.toString());
  assert.equal(config.ssl.ca, pem);
  assert.notEqual(config.ssl.rejectUnauthorized, false);
  assert.equal(config.ssl.checkServerIdentity, undefined);
});

test("production PostgreSQL preparation uses SELECT-only checks and never migrations or store DDL", async () => {
  const connection = fakeConnection();
  const adapter = {
    getConnection: async () => connection,
    runPluginMigrations: async () => {
      throw new Error("must_not_run");
    },
  };
  const store = await initializeRuntimeDatabase(adapter, { postgresUrl: url });
  assert.equal(store.connection, connection);
  assert.ok(connection.queries.every((sql) => /^SELECT\b/i.test(sql.trim())));
  assert.equal(connection.options.max, 2);
  assert.equal(connection.options.min, 0);
  assert.equal(connection.options.connectionTimeoutMillis, 5000);
  assert.equal(connection.options.statement_timeout, 15000);
  assert.equal(connection.options.query_timeout, 20000);
  assert.equal(connection.options.lock_timeout, 5000);
  const missing = fakeConnection({ tables: ["agents"] });
  await assert.rejects(
    initializeRuntimeDatabase(
      { ...adapter, getConnection: async () => missing },
      { postgresUrl: url },
    ),
    /postgres_bootstrap_required/,
  );
});

test("production role must be custom and cannot bypass RLS, create roles, schemas or public objects", async () => {
  await verifyRuntimeDatabaseRole(fakeConnection());
  for (const role of [
    { ...restrictedRole, role: "postgres" },
    { ...restrictedRole, role: "service_role" },
    { ...restrictedRole, rolbypassrls: true },
    { ...restrictedRole, rolcreaterole: true },
    { ...restrictedRole, can_create_schema: true },
    { ...restrictedRole, can_create_public: true },
  ]) {
    await assert.rejects(
      verifyRuntimeDatabaseRole(fakeConnection({ role })),
      /postgres_restricted_runtime_role_required/,
    );
  }
});

test("bootstrap pins one live session and bounds SQL execution, query and lock time", () => {
  const connection = fakeConnection();
  configurePostgresConnection(connection, { bootstrap: true });
  assert.equal(connection.options.max, 1);
  assert.equal(connection.options.idleTimeoutMillis, 0);
  assert.equal(connection.options.statement_timeout, 60000);
  assert.equal(connection.options.query_timeout, 65000);
  assert.equal(connection.options.lock_timeout, 5000);
});
