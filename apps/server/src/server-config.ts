import path from "node:path";

export interface ServerConfig {
  port: number;
  walDir: string;
  snapshotsDir: string;
  vaultDir: string;
  derivedDir: string;
  snapshotRetentionMax: number;
  hmacSecret: string;
  authToken: string;
  sourcePathAllowlistRoots: string[];
  dedupStrongDistanceThreshold: number;
  dedupProbableDistanceThreshold: number;
}

export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const port = Number(env.PORT ?? 3000);
  const dataDir = env.DATA_DIR ?? path.join(process.cwd(), "data");
  const walDir = env.WAL_DIR ?? path.join(dataDir, "wal");
  const snapshotsDir = env.SNAPSHOTS_DIR ?? path.join(dataDir, "snapshots");
  const vaultDir = env.VAULT_DIR ?? path.join(dataDir, "vault");
  const derivedDir = env.DERIVED_DIR ?? path.join(dataDir, "derived");
  const snapshotRetentionRaw = Number(env.SNAPSHOT_RETENTION_MAX ?? 20);
  const snapshotRetentionMax = Number.isFinite(snapshotRetentionRaw)
    ? Math.max(0, Math.floor(snapshotRetentionRaw))
    : 20;
  const hmacSecret = env.WAL_HMAC_SECRET?.trim() ?? "";
  if (!hmacSecret) {
    throw new Error("WAL_HMAC_SECRET is required");
  }

  const authToken = env.AUTH_TOKEN?.trim() ?? "";
  const sourcePathAllowlistRoots = (env.SOURCE_PATH_ALLOWLIST_ROOTS ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const dedupStrongDistanceThreshold = normalizeNonNegativeInt(env.DEDUP_STRONG_DISTANCE_THRESHOLD, 4);
  const dedupProbableDistanceThreshold = normalizeNonNegativeInt(env.DEDUP_PROBABLE_DISTANCE_THRESHOLD, 10);

  return {
    port,
    walDir,
    snapshotsDir,
    vaultDir,
    derivedDir,
    snapshotRetentionMax,
    hmacSecret,
    authToken,
    sourcePathAllowlistRoots,
    dedupStrongDistanceThreshold,
    dedupProbableDistanceThreshold
  };
}

function normalizeNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}
