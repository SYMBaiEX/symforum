// Importing runtime also suppresses upstream SQL logs; never print raw database
// errors, URLs, connection options, or environment values in this helper.
import "../src/runtime.mjs";
import { bootstrapPostgres } from "../src/database.mjs";
import { WorkerError } from "../src/contract.mjs";

try {
  const result = await bootstrapPostgres({
    postgresUrl: process.env.ELIZA_SHADOW_BOOTSTRAP_DATABASE_URL,
  });
  console.log(
    JSON.stringify({ event: "postgres_bootstrap_complete", ...result }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "postgres_bootstrap_failed",
      code: error instanceof WorkerError ? error.code : "bootstrap_failed",
    }),
  );
  process.exitCode = 1;
}
