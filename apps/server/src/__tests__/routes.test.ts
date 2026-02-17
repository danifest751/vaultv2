import http from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createEvent, newMediaId, newSourceEntryId, newSourceId } from "@family-media-vault/core";
import { DomainState } from "@family-media-vault/storage";
import { JobEngine, JobStore } from "@family-media-vault/jobs";
import { createRequestHandler } from "../routes";
import { ServerRuntime } from "../bootstrap";

interface StartServerOptions {
  authToken?: string;
  sourcePathAllowlistRoots?: string[];
}

function createRuntime(): ServerRuntime {
  const state = new DomainState();
  const jobStore = new JobStore();
  const jobEngine = new JobEngine({
    store: jobStore,
    eventWriter: {
      append: async () => {
        return;
      }
    },
    concurrency: 1
  });

  return {
    state,
    jobStore,
    jobEngine,
    appendEvent: async () => {
      return;
    },
    vault: { root: "C:/tmp/vault" },
    derived: { root: "C:/tmp/derived" },
    snapshotsDir: "C:/tmp/snapshots",
    getLastWalSeq: () => 0
  };
}

describe("server routes", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          })
      )
    );
    servers.length = 0;
  });

  async function startServer(
    runtime: ServerRuntime,
    options: StartServerOptions = {}
  ): Promise<{ baseUrl: string }> {
    const server = http.createServer(createRequestHandler(runtime, options));
    servers.push(server);

    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => resolve());
      server.on("error", reject);
    });

    const address = server.address() as AddressInfo;
    return { baseUrl: `http://127.0.0.1:${address.port}` };
  }

  it("returns health status", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("returns ui page", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/ui`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("Family Media Vault — Dev Console");
    expect(text).not.toContain("JavaScript is loading...");
    expect(text).not.toContain("UI Ready! All buttons should work now.");
    expect(text).toContain("id=\"job-queue-toggle\"");
    expect(text).toContain("id=\"media-view-controls\"");
    expect(text).toContain("id=\"view-tiles\"");
    expect(text).toContain("id=\"view-list\"");
    expect(text).toContain("id=\"view-table\"");
    expect(text).toContain("media-glyph");
    expect(text).toContain("data-thumb-src");
    expect(text).toContain("id=\"auth-token\"");
    expect(text).toContain("id=\"auth-token-save\"");
    expect(text).toContain("Delete source?\\n");
  });

  it("requires auth token for protected routes when configured", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime, { authToken: "secret-token" });

    const noToken = await fetch(`${baseUrl}/sources`);
    const withToken = await fetch(`${baseUrl}/sources`, {
      headers: { authorization: "Bearer secret-token" }
    });
    const withQueryToken = await fetch(`${baseUrl}/sources?token=secret-token`);
    const health = await fetch(`${baseUrl}/health`);

    expect(noToken.status).toBe(401);
    expect(withToken.status).toBe(200);
    expect(withQueryToken.status).toBe(401);
    expect(health.status).toBe(200);
  });

  it("allows media asset access with short-lived signed token", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const sourceEntryId = newSourceEntryId();
    const mediaId = newMediaId();

    runtime.state.applyEvent(
      createEvent("SOURCE_CREATED", {
        source: {
          sourceId,
          path: "C:/tmp/source",
          recursive: true,
          includeArchives: false,
          excludeGlobs: [],
          createdAt: Date.now()
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/a.jpg",
          size: 11,
          mtimeMs: Date.now(),
          fingerprint: "11:1:head",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId,
          sha256: "d".repeat(64),
          size: 11,
          sourceEntryId
        }
      })
    );

    const { baseUrl } = await startServer(runtime, { authToken: "secret-token" });

    const unauthorizedAsset = await fetch(`${baseUrl}/derived/${mediaId}/thumb`);
    expect(unauthorizedAsset.status).toBe(401);

    const tokenResp = await fetch(`${baseUrl}/auth/asset-token`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" }
    });
    expect(tokenResp.status).toBe(201);
    const tokenBody = (await tokenResp.json()) as { token: string; expiresAt: number };

    const signedAsset = await fetch(
      `${baseUrl}/derived/${mediaId}/thumb?sat=${encodeURIComponent(tokenBody.token)}`
    );
    const signedBody = (await signedAsset.json()) as { error: string };
    expect(signedAsset.status).toBe(404);
    expect(signedBody.error).toBe("derived_not_found");
  });

  it("returns health tools status as public endpoint", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime, { authToken: "secret-token" });

    const response = await fetch(`${baseUrl}/health/tools`);
    const body = (await response.json()) as {
      status: string;
      checkedAt: number;
      tools: {
        exiftool: boolean;
        ffprobe: boolean;
        ffmpeg: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(typeof body.checkedAt).toBe("number");
    expect(typeof body.tools.exiftool).toBe("boolean");
    expect(typeof body.tools.ffprobe).toBe("boolean");
    expect(typeof body.tools.ffmpeg).toBe("boolean");
  });

  it("validates source creation payload", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("path_required");
  });

  it("rejects source path outside allowlist roots", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime, {
      sourcePathAllowlistRoots: ["C:/allowed"]
    });

    const response = await fetch(`${baseUrl}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "C:/blocked/media" })
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe("source_path_not_allowed");
  });

  it("returns paginated media payload shape", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/media?limit=10&offset=5`);
    const body = (await response.json()) as {
      media: unknown[];
      total: number;
      limit: number;
      offset: number;
    };

    expect(response.status).toBe(200);
    expect(Array.isArray(body.media)).toBe(true);
    expect(body.total).toBe(0);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(5);
  });

  it("returns derived_not_found when derived asset is not generated yet", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const sourceEntryId = newSourceEntryId();
    const mediaId = newMediaId();

    runtime.state.applyEvent(
      createEvent("SOURCE_CREATED", {
        source: {
          sourceId,
          path: "C:/tmp/source",
          recursive: true,
          includeArchives: false,
          excludeGlobs: [],
          createdAt: Date.now()
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/a.jpg",
          size: 11,
          mtimeMs: Date.now(),
          fingerprint: "11:1:head",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId,
          sha256: "c".repeat(64),
          size: 11,
          sourceEntryId
        }
      })
    );

    const { baseUrl } = await startServer(runtime);
    const response = await fetch(`${baseUrl}/derived/${mediaId}/thumb`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("derived_not_found");
  });

  it("returns 404 for unknown route", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/unknown`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("not_found");
  });
});
