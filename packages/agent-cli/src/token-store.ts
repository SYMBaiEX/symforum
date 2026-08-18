import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

export class FileTokenStore {
  constructor(private readonly path: string) {}

  async getToken() {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const details = await lstat(this.path);
      if (details.isSymbolicLink())
        throw new Error("Token file must not be a symbolic link.");
      if ((details.mode & 0o077) !== 0)
        throw new Error("Token file permissions must be 0600.");
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile())
        throw new Error("Token path must be a regular file.");
      const token = (await handle.readFile("utf8")).trim();
      return token || null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async setToken(token: string) {
    if (!token.trim()) throw new TypeError("Token must not be empty.");
    await ensurePrivateParentDirectory(dirname(this.path));
    try {
      const existing = await lstat(this.path);
      if (existing.isSymbolicLink())
        throw new Error("Token file must not be a symbolic link.");
      throw createExistsError();
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        this.path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(`${token.trim()}\n`, "utf8");
    } finally {
      await handle?.close();
    }
    await chmod(this.path, 0o600);
  }
}

async function ensurePrivateParentDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error("Token parent directory must not be a symbolic link.");
  }
  // Only the explicit token parent is tightened; ancestor directories may be
  // shared application or user directories and are deliberately left alone.
  await chmod(path, 0o700);
}

function createExistsError() {
  const error = new Error(
    "Token file already exists; refusing to overwrite it.",
  ) as NodeJS.ErrnoException;
  error.code = "EEXIST";
  return error;
}

function isMissing(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}
