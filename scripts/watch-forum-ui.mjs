import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Watch sources, never generated output. A single build runs at a time; edits
// made during it trigger one subsequent build, keeping the portable UI current.
const root = resolve(import.meta.dirname, "..");
let timer;
let child;
let dirty = false;
let stopping = false;
function rebuild() {
  if (stopping) return;
  if (child) {
    dirty = true;
    return;
  }
  dirty = false;
  child = spawn("bun", ["run", "ui:sync"], { cwd: root, stdio: "inherit" });
  child.on("close", () => {
    child = undefined;
    if (dirty) rebuild();
  });
  child.on("error", (error) => {
    console.error(error);
  });
}
const watchers = ["apps/forum/app", "components", "lib", "styles"].map((directory) =>
  watch(resolve(root, directory), { recursive: true }, (_event, file) => {
    if (
      !file ||
      file.includes(".generated.") ||
      /\.(test|spec)\./.test(file) ||
      !/\.(tsx?|css)$/.test(file)
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 250);
  }),
);
const configWatcher = watch(resolve(root, "tailwind.config.ts"), () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 250);
});
function stop() {
  stopping = true;
  clearTimeout(timer);
  watchers.forEach((watcher) => watcher.close());
  configWatcher.close();
  child?.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log("Watching forum sources for automatic plugin UI updates.");
