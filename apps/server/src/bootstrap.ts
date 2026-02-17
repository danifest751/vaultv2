import path from "node:path";
import { promises as fs } from "node:fs";
import { createEvent, DomainEvent } from "@family-media-vault/core";
import {
  DerivedLayout,
  DomainState,
  VaultLayout,
  WalWriter,
  ensureDir,
  readWalRecords,
  rebuildDomainState
} from "@family-media-vault/storage";
import {
  JobEngine,
  JobStore,
  createIngestJobHandler,
  createDerivedGenerateJobHandler,
  createMetadataJobHandler,
  createProbableDedupJobHandler,
  createScanJobHandler,
  createQuarantineAcceptJobHandler,
  createQuarantineRejectJobHandler,
  rebuildJobStore
} from "@family-media-vault/jobs";

export interface BootstrapOptions {
  walDir: string;
  snapshotsDir: string;
  vaultDir: string;
  derivedDir: string;
  hmacSecret: string;
  derivedGenerateMaxAttempts: number;
  dedupStrongDistanceThreshold: number;
  dedupProbableDistanceThreshold: number;
}

export interface ServerRuntime {
  state: DomainState;
  jobStore: JobStore;
  jobEngine: JobEngine;
  appendEvent: (event: ReturnType<typeof createEvent>) => Promise<void>;
  vault: VaultLayout;
  derived: DerivedLayout;
  snapshotsDir: string;
  getLastWalSeq: () => number;
}

export async function bootstrapServerRuntime(options: BootstrapOptions): Promise<ServerRuntime> {
  await ensureDir(options.walDir);
  await ensureDir(options.snapshotsDir);
  await ensureDir(options.vaultDir);
  await ensureDir(options.derivedDir);

  let lastWalSeq = 0;
  let state: DomainState;
  let writer: WalWriter;
  let jobStore: JobStore;

  try {
    state = await rebuildDomainState({
      walDir: options.walDir,
      snapshotsDir: options.snapshotsDir,
      hmacSecret: options.hmacSecret
    });
    writer = await WalWriter.create({
      walDir: options.walDir,
      hmacSecret: options.hmacSecret,
      fsync: true
    });
    jobStore = await rebuildJobStore(
      (async function* () {
        for await (const record of readWalRecords({
          walDir: options.walDir,
          hmacSecret: options.hmacSecret
        })) {
          lastWalSeq = record.seq;
          yield record.event;
        }
      })()
    );
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const walBackup = `${options.walDir}.corrupt.${stamp}`;
    const snapshotsBackup = `${options.snapshotsDir}.corrupt.${stamp}`;
    try {
      await fs.rename(options.walDir, walBackup);
    } catch {}
    try {
      await fs.rename(options.snapshotsDir, snapshotsBackup);
    } catch {}

    await ensureDir(options.walDir);
    await ensureDir(options.snapshotsDir);

    state = new DomainState();
    writer = await WalWriter.create({
      walDir: options.walDir,
      hmacSecret: options.hmacSecret,
      fsync: true
    });
    jobStore = new JobStore();
    lastWalSeq = 0;
  }

  const jobEngine = new JobEngine({
    store: jobStore,
    eventWriter: {
      append: async (event: DomainEvent) => {
        const record = await writer.append(event);
        lastWalSeq = record.seq;
        state.applyEvent(event);
        jobStore.applyEvent(event);
      }
    },
    concurrency: 2
  });

  const appendEvent = async (event: ReturnType<typeof createEvent>) => {
    const record = await writer.append(event as DomainEvent);
    lastWalSeq = record.seq;
    state.applyEvent(event as DomainEvent);
    jobStore.applyEvent(event as DomainEvent);
  };

  const vault: VaultLayout = { root: options.vaultDir };
  const derived: DerivedLayout = { root: options.derivedDir };

  jobEngine.register({
    kind: "scan:source",
    handler: createScanJobHandler({ state, appendEvent, jobEngine })
  });
  jobEngine.register({
    kind: "ingest:stage-a-b",
    handler: createIngestJobHandler({ state, appendEvent, vault, jobEngine })
  });
  jobEngine.register({
    kind: "metadata:extract",
    handler: createMetadataJobHandler({ state, appendEvent, jobEngine })
  });
  jobEngine.register({
    kind: "derived:generate",
    maxAttempts: options.derivedGenerateMaxAttempts,
    handler: createDerivedGenerateJobHandler({ state, vault, derived })
  });
  jobEngine.register({
    kind: "dedup:probable",
    handler: createProbableDedupJobHandler({
      state,
      appendEvent,
      strongDistanceThreshold: options.dedupStrongDistanceThreshold,
      probableDistanceThreshold: options.dedupProbableDistanceThreshold
    })
  });
  jobEngine.register({
    kind: "quarantine:accept",
    handler: createQuarantineAcceptJobHandler({ state, appendEvent })
  });
  jobEngine.register({
    kind: "quarantine:reject",
    handler: createQuarantineRejectJobHandler({ state, appendEvent })
  });

  jobEngine.resumePending();

  return {
    state,
    jobStore,
    jobEngine,
    appendEvent,
    vault,
    derived,
    snapshotsDir: options.snapshotsDir,
    getLastWalSeq: () => lastWalSeq
  };
}
