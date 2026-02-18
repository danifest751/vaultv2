import http from "node:http";
import { bootstrapServerRuntime } from "./bootstrap";
import { createRequestHandler } from "./routes";
import { ServerConfig } from "./server-config";

export async function startServer(config: ServerConfig): Promise<http.Server> {
  const runtime = await bootstrapServerRuntime({
    walDir: config.walDir,
    snapshotsDir: config.snapshotsDir,
    vaultDir: config.vaultDir,
    derivedDir: config.derivedDir,
    hmacSecret: config.hmacSecret,
    jobConcurrencyTotal: config.jobConcurrencyTotal,
    jobConcurrencyIo: config.jobConcurrencyIo,
    jobConcurrencyCpu: config.jobConcurrencyCpu,
    jobConcurrencyControl: config.jobConcurrencyControl,
    derivedGenerateMaxAttempts: config.derivedGenerateMaxAttempts,
    dedupStrongDistanceThreshold: config.dedupStrongDistanceThreshold,
    dedupProbableDistanceThreshold: config.dedupProbableDistanceThreshold
  });

  const server = http.createServer(
    createRequestHandler(runtime, {
      authToken: config.authToken,
      sourcePathAllowlistRoots: config.sourcePathAllowlistRoots,
      snapshotRetentionMax: config.snapshotRetentionMax
    })
  );

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => resolve());
  });

  process.stdout.write(`server: http://localhost:${config.port}\n`);
  return server;
}
