import { readFile, readdir } from "node:fs/promises";
import { developerIndexNowPayload } from "../lib/developer-indexnow";

const args = process.argv.slice(2);
if (args.length !== 1 || !["--check", "--submit"].includes(args[0]))
  throw new Error(
    "Usage: bun scripts/submit-developer-indexnow.ts --check | --submit",
  );
const directory = new URL("../public/", import.meta.url);
const proofs = (await readdir(directory)).filter((file) =>
  /^indexnow-[A-Za-z0-9-]{8,128}\.txt$/.test(file),
);
if (proofs.length !== 1)
  throw new Error("Expected exactly one existing IndexNow ownership file");
const key = (await readFile(new URL(proofs[0], directory), "utf8")).trim();
const payload = developerIndexNowPayload(key);
if (proofs[0] !== `indexnow-${key}.txt`)
  throw new Error("Ownership file name and content differ");
const proof = await fetch(payload.keyLocation, {
  redirect: "error",
  signal: AbortSignal.timeout(10_000),
});
if (!proof.ok || (await proof.text()).trim() !== key)
  throw new Error("Existing IndexNow proof is not live");
// Bounded concurrency and a fixed public allowlist; no owner IDs, query strings or credentials are sent.
for (let i = 0; i < payload.urlList.length; i += 3) {
  await Promise.all(
    payload.urlList.slice(i, i + 3).map(async (url) => {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (
        !response.ok ||
        /noindex/i.test(response.headers.get("x-robots-tag") ?? "")
      )
        throw new Error(
          `Public indexing preflight failed for ${new URL(url).pathname}`,
        );
    }),
  );
}
if (args[0] === "--check") {
  console.log(
    `IndexNow preflight passed for ${payload.urlList.length} canonical public documentation URLs. Nothing submitted.`,
  );
} else {
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(payload),
  });
  await response.body?.cancel();
  if (![200, 202].includes(response.status))
    throw new Error(
      `IndexNow rejected the notification: HTTP ${response.status}`,
    );
  console.log(
    `IndexNow received ${payload.urlList.length} documentation URLs (HTTP ${response.status}${response.status === 202 ? "; ownership validation pending" : ""}). This is receipt, not proof of indexing or ranking.`,
  );
}
