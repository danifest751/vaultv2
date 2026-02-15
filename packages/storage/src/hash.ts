import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";

export async function hashFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }

  return hash.digest("hex");
}

export async function hashFirst64kSha256(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const hash = createHash("sha256");
    hash.update(buffer.subarray(0, bytesRead));
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
