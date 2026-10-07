import { readFileSync } from "node:fs";

// Feed this a bounded `convex logs --success --jsonl` capture. No credentials,
// bodies, identities, request IDs, or log messages are copied into the report.
const file = process.argv[2];
if (!file)
  throw new Error(
    "Usage: bun scripts/summarize-convex-usage.mjs capture.jsonl",
  );
const functions = new Map();
let first = Infinity;
let last = -Infinity;
for (const line of readFileSync(file, "utf8").split("\n")) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  // Progress events describe an execution; they are not another billed call.
  if (row.kind !== "Completion") continue;
  const name = `${row.componentPath ?? "app"} ${row.identifier}`;
  const stats = row.usageStats ?? {};
  const total = functions.get(name) ?? {
    calls: 0,
    cached: 0,
    readBytes: 0,
    writeBytes: 0,
    readDocuments: 0,
    egressBytes: 0,
    returnBytes: 0,
    actionSeconds: 0,
    actionGbHours: 0,
  };
  total.calls++;
  total.cached += row.cachedResult ? 1 : 0;
  for (const [field, source] of [
    ["readBytes", "databaseIoReadBytes"],
    ["writeBytes", "databaseIoWriteBytes"],
    ["readDocuments", "databaseReadDocuments"],
    ["egressBytes", "networkEgressBytes"],
  ])
    total[field] += stats[source] ?? 0;
  total.returnBytes += row.returnBytes ?? 0;
  if (["Action", "HttpAction"].includes(row.udfType)) {
    const seconds = row.executionTime ?? 0;
    total.actionSeconds += seconds;
    total.actionGbHours += (seconds * (stats.memoryUsedMb ?? 0)) / 1024 / 3600;
  }
  functions.set(name, total);
  first = Math.min(first, row.timestamp);
  last = Math.max(last, row.timestamp);
}
if (!functions.size) throw new Error("Capture contains no completion events.");
const totals = {};
for (const values of functions.values()) {
  for (const [key, value] of Object.entries(values))
    totals[key] = (totals[key] ?? 0) + value;
}
console.log(
  JSON.stringify(
    {
      startUTC: new Date(first * 1000).toISOString(),
      endUTC: new Date(last * 1000).toISOString(),
      minutes: (last - first) / 60,
      totals,
      functions: Object.fromEntries(
        [...functions].sort((a, b) => b[1].readBytes - a[1].readBytes),
      ),
    },
    null,
    2,
  ),
);
