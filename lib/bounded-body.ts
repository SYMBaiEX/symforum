/** Portable Web API reader: enforce the cap while streaming, before buffering. */
export class BodyReadError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
  }
}

export async function readBoundedBody(request: Request, limit: number) {
  const reject = (status: 400 | 413 | 415, message: string): never => {
    void request.body?.cancel().catch(() => {});
    throw new BodyReadError(status, message);
  };
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length))
    reject(400, "Invalid request length.");
  if (length !== null && Number(length) > limit)
    reject(413, "Request body is too large.");
  const encoding = request.headers
    .get("content-encoding")
    ?.trim()
    .toLowerCase();
  if (encoding && encoding !== "identity")
    reject(415, "Unsupported request encoding.");

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new BodyReadError(413, "Request body is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BodyReadError) throw error;
    throw new BodyReadError(400, "Could not read request body.");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
