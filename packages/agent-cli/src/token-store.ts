import { chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

export class FileTokenStore {
  constructor(private readonly path: string) {}

  async getToken() {
    try {
      const details = await stat(this.path);
      if ((details.mode & 0o077) !== 0)
        throw new Error("Token file permissions must be 0600.");
      const token = (await readFile(this.path, "utf8")).trim();
      return token || null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async setToken(token: string) {
    if (!token.trim()) throw new TypeError("Token must not be empty.");
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.path, "wx", 0o600);
      await handle.writeFile(`${token.trim()}\n`, "utf8");
    } finally {
      await handle?.close();
    }
    await chmod(this.path, 0o600);
  }
}

function isMissing(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}
