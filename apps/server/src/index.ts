import { loadServerConfig } from "./server-config";
import { startServer } from "./server";

async function main(): Promise<void> {
  const config = loadServerConfig(process.env);
  await startServer(config);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
