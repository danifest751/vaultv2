import path from "node:path";
import { promises as fs } from "node:fs";
import { ensureDir } from "./utils";

export interface VaultLayout {
  root: string;
}

export function mediaPathForSha256(layout: VaultLayout, sha256: string): string {
  const aa = sha256.slice(0, 2);
  const bb = sha256.slice(2, 4);
  return path.join(layout.root, "media", "sha256", aa, bb, sha256);
}

export async function ensureMediaStored(
  layout: VaultLayout,
  sourcePath: string,
  sha256: string
): Promise<string> {
  const targetPath = mediaPathForSha256(layout, sha256);
  try {
    await fs.access(targetPath);
    return targetPath;
  } catch {
    // continue to write
  }

  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
  return targetPath;
}
