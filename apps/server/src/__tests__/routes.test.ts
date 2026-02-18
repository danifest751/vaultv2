import http from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { asMediaId, createEvent, newMediaId, newSourceEntryId, newSourceId } from "@family-media-vault/core";
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

  it("supports albums CRUD", async () => {
    const runtime = createRuntime();
    runtime.appendEvent = async (event) => {
      runtime.state.applyEvent(event as never);
    };
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
          fingerprint: "11:1:head-a",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId,
          sha256: "a".repeat(64),
          size: 11,
          sourceEntryId
        }
      })
    );

    const { baseUrl } = await startServer(runtime);

    const createResponse = await fetch(`${baseUrl}/albums`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Trip", mediaIds: [mediaId, mediaId] })
    });
    const createBody = (await createResponse.json()) as {
      album: { albumId: string; name: string; mediaIds: string[] };
    };

    expect(createResponse.status).toBe(201);
    expect(createBody.album.name).toBe("Trip");
    expect(createBody.album.mediaIds).toEqual([mediaId]);
    expect(runtime.state.albums.list()).toHaveLength(1);

    const albumId = createBody.album.albumId;
    const listResponse = await fetch(`${baseUrl}/albums`);
    const listBody = (await listResponse.json()) as {
      albums: Array<{ albumId: string; name: string; mediaIds: string[] }>;
    };

    expect(listResponse.status).toBe(200);
    expect(listBody.albums).toHaveLength(1);
    expect(listBody.albums[0]?.albumId).toBe(albumId);

    const updateResponse = await fetch(`${baseUrl}/albums/${encodeURIComponent(albumId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Trip 2026" })
    });
    const updateBody = (await updateResponse.json()) as {
      album: { albumId: string; name: string; mediaIds: string[] };
    };

    expect(updateResponse.status).toBe(200);
    expect(updateBody.album.albumId).toBe(albumId);
    expect(updateBody.album.name).toBe("Trip 2026");
    expect(updateBody.album.mediaIds).toEqual([mediaId]);

    const deleteResponse = await fetch(`${baseUrl}/albums/${encodeURIComponent(albumId)}`, {
      method: "DELETE"
    });
    const deleteBody = (await deleteResponse.json()) as { albumId: string };

    expect(deleteResponse.status).toBe(200);
    expect(deleteBody.albumId).toBe(albumId);

    const listAfterDeleteResponse = await fetch(`${baseUrl}/albums`);
    const listAfterDeleteBody = (await listAfterDeleteResponse.json()) as {
      albums: Array<{ albumId: string }>;
    };

    expect(listAfterDeleteResponse.status).toBe(200);
    expect(listAfterDeleteBody.albums).toHaveLength(0);
  });

  it("validates album mediaIds existence", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/albums`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Trip", mediaIds: ["med_missing"] })
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("album_media_not_found");
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

  it("returns media search results using indexed filters", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const sourceEntryIdA = newSourceEntryId();
    const sourceEntryIdB = newSourceEntryId();
    const mediaIdA = newMediaId();
    const mediaIdB = newMediaId();

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
          sourceEntryId: sourceEntryIdA,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/a.jpg",
          size: 11,
          mtimeMs: Date.now(),
          fingerprint: "11:1:head-a",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: sourceEntryIdB,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/b.jpg",
          size: 12,
          mtimeMs: Date.now(),
          fingerprint: "12:1:head-b",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId: mediaIdA,
          sha256: "ab".repeat(32),
          size: 11,
          sourceEntryId: sourceEntryIdA
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId: mediaIdB,
          sha256: "b".repeat(64),
          size: 12,
          sourceEntryId: sourceEntryIdB
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaIdA,
        sourceEntryId: sourceEntryIdA,
        metadata: {
          kind: "photo",
          mimeType: "image/jpeg",
          cameraModel: "Canon EOS R6",
          takenAt: Date.parse("2024-01-02T10:11:12.000Z"),
          raw: {
            gpsLatitude: 55.751,
            gpsLongitude: 37.617
          }
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaIdB,
        sourceEntryId: sourceEntryIdB,
        metadata: {
          kind: "video",
          mimeType: "video/mp4",
          cameraModel: "Sony A7",
          takenAt: Date.parse("2024-01-03T10:11:12.000Z")
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("DUPLICATE_LINK_CREATED", {
        link: {
          duplicateLinkId: "dup_test" as never,
          mediaId: mediaIdA,
          sourceEntryId: sourceEntryIdB,
          level: "strong",
          createdAt: Date.now(),
          reason: "test"
        }
      })
    );

    const { baseUrl } = await startServer(runtime);
    const response = await fetch(
      `${baseUrl}/media/search?kind=photo&mimeType=image%2Fjpeg&sourceId=${encodeURIComponent(String(sourceId))}&duplicateLevel=strong&cameraModel=${encodeURIComponent("Canon EOS R6")}&takenDay=2024-01-02&gpsTile=55.7%3A37.6&sha256Prefix=ABABABAB&limit=5&offset=0`
    );
    const body = (await response.json()) as {
      media: Array<{ mediaId: string }>;
      total: number;
      limit: number;
      offset: number;
      filters: {
        kind: string | null;
        mimeType: string | null;
        sourceId: string | null;
        duplicateLevel: string | null;
        cameraModel: string | null;
        takenDay: string | null;
        gpsTile: string | null;
        sha256Prefix: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.media).toHaveLength(1);
    expect(body.media[0]?.mediaId).toBe(mediaIdA);
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(0);
    expect(body.filters.kind).toBe("photo");
    expect(body.filters.mimeType).toBe("image/jpeg");
    expect(body.filters.sourceId).toBe(String(sourceId));
    expect(body.filters.duplicateLevel).toBe("strong");
    expect(body.filters.cameraModel).toBe("Canon EOS R6");
    expect(body.filters.takenDay).toBe("2024-01-02");
    expect(body.filters.gpsTile).toBe("55.7:37.6");
    expect(body.filters.sha256Prefix).toBe("abababab");
  });

  it("returns media search results for sha256Prefix filter", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const sourceEntryIdA = newSourceEntryId();
    const sourceEntryIdB = newSourceEntryId();
    const mediaIdA = newMediaId();
    const mediaIdB = newMediaId();

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
          sourceEntryId: sourceEntryIdA,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/a.jpg",
          size: 11,
          mtimeMs: Date.now(),
          fingerprint: "11:1:head-a",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: sourceEntryIdB,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/b.jpg",
          size: 12,
          mtimeMs: Date.now(),
          fingerprint: "12:1:head-b",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId: mediaIdA,
          sha256: "ab".repeat(32),
          size: 11,
          sourceEntryId: sourceEntryIdA
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId: mediaIdB,
          sha256: "cd".repeat(32),
          size: 12,
          sourceEntryId: sourceEntryIdB
        }
      })
    );

    const { baseUrl } = await startServer(runtime);
    const response = await fetch(`${baseUrl}/media/search?sha256Prefix=ABAB`);
    const body = (await response.json()) as {
      media: Array<{ mediaId: string }>;
      total: number;
      filters: { sha256Prefix: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.media).toHaveLength(1);
    expect(body.media[0]?.mediaId).toBe(mediaIdA);
    expect(body.filters.sha256Prefix).toBe("abab");
  });

  it("supports sha256Prefix filters with length 3, 5 and 9", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const sourceEntryIdA = newSourceEntryId();
    const sourceEntryIdB = newSourceEntryId();
    const mediaIdA = newMediaId();
    const mediaIdB = newMediaId();

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
          sourceEntryId: sourceEntryIdA,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/a.jpg",
          size: 11,
          mtimeMs: Date.now(),
          fingerprint: "11:1:head-a",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: sourceEntryIdB,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/b.jpg",
          size: 12,
          mtimeMs: Date.now(),
          fingerprint: "12:1:head-b",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId: mediaIdA,
          sha256: "abcdefff".repeat(8),
          size: 11,
          sourceEntryId: sourceEntryIdA
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId: mediaIdB,
          sha256: "abf01234".repeat(8),
          size: 12,
          sourceEntryId: sourceEntryIdB
        }
      })
    );

    const { baseUrl } = await startServer(runtime);

    for (const prefix of ["ABC", "abcde", "AbCdEfFfA"]) {
      const response = await fetch(`${baseUrl}/media/search?sha256Prefix=${encodeURIComponent(prefix)}`);
      const body = (await response.json()) as {
        media: Array<{ mediaId: string }>;
        total: number;
        filters: { sha256Prefix: string | null };
      };

      expect(response.status).toBe(200);
      expect(body.total).toBe(1);
      expect(body.media).toHaveLength(1);
      expect(body.media[0]?.mediaId).toBe(mediaIdA);
      expect(body.filters.sha256Prefix).toBe(prefix.toLowerCase());
    }
  });

  it("returns 400 when media search is called without filters", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/media/search?limit=10&offset=0`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("search_filter_required");
  });

  it("returns 400 for invalid duplicateLevel filter", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/media/search?duplicateLevel=near`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_duplicate_level_filter");
  });

  it("returns 400 for invalid takenDay filter", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/media/search?takenDay=20240102`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_taken_day_filter");
  });

  it("returns 400 for invalid gpsTile filter", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/media/search?gpsTile=%20%20%20`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_gps_tile_filter");
  });

  it("returns 400 for invalid sha256Prefix filter", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/media/search?sha256Prefix=xyz`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_sha256_prefix_filter");
  });

  it("matches cameraModel filter case-insensitively", async () => {
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
          fingerprint: "11:1:head-a",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId,
          sha256: "a".repeat(64),
          size: 11,
          sourceEntryId
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId,
        sourceEntryId,
        metadata: {
          kind: "photo",
          mimeType: "image/jpeg",
          cameraModel: "Canon EOS R6"
        }
      })
    );

    const { baseUrl } = await startServer(runtime);
    const response = await fetch(`${baseUrl}/media/search?cameraModel=canon%20eos%20r6`);
    const body = (await response.json()) as {
      media: Array<{ mediaId: string }>;
      total: number;
      filters: { cameraModel: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.media).toHaveLength(1);
    expect(body.media[0]?.mediaId).toBe(mediaId);
    expect(body.filters.cameraModel).toBe("canon eos r6");
  });

  it("supports cursor pagination for media search", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const entryIds = [newSourceEntryId(), newSourceEntryId(), newSourceEntryId()];
    const mediaIds = [newMediaId(), newMediaId(), newMediaId()];

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

    for (let i = 0; i < entryIds.length; i += 1) {
      const sourceEntryId = entryIds[i];
      const mediaId = mediaIds[i];
      if (!sourceEntryId || !mediaId) {
        continue;
      }

      runtime.state.applyEvent(
        createEvent("SOURCE_ENTRY_UPSERTED", {
          entry: {
            sourceEntryId,
            sourceId,
            kind: "file",
            path: `C:/tmp/source/${i}.jpg`,
            size: 10 + i,
            mtimeMs: Date.now(),
            fingerprint: `${10 + i}:1:head-${i}`,
            lastSeenAt: Date.now(),
            state: "active"
          }
        })
      );
      runtime.state.applyEvent(
        createEvent("MEDIA_IMPORTED", {
          media: {
            mediaId,
            sha256: `${i}`.repeat(64),
            size: 10 + i,
            sourceEntryId
          }
        })
      );
      runtime.state.applyEvent(
        createEvent("MEDIA_METADATA_EXTRACTED", {
          mediaId,
          sourceEntryId,
          metadata: { kind: "photo", mimeType: "image/jpeg", takenAt: 100 + i }
        })
      );
    }

    const { baseUrl } = await startServer(runtime);
    const firstResponse = await fetch(`${baseUrl}/media/search?kind=photo&sort=mediaId_asc&limit=2`);
    const firstBody = (await firstResponse.json()) as {
      media: Array<{ mediaId: string }>;
      total: number;
      nextCursor: string | null;
    };

    expect(firstResponse.status).toBe(200);
    expect(firstBody.total).toBe(3);
    expect(firstBody.media).toHaveLength(2);
    expect(typeof firstBody.nextCursor).toBe("string");

    const secondResponse = await fetch(
      `${baseUrl}/media/search?kind=photo&sort=mediaId_asc&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`
    );
    const secondBody = (await secondResponse.json()) as {
      media: Array<{ mediaId: string }>;
      total: number;
      nextCursor: string | null;
    };

    expect(secondResponse.status).toBe(200);
    expect(secondBody.total).toBe(3);
    expect(secondBody.media).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();

    const firstIds = new Set(firstBody.media.map((item) => item.mediaId));
    for (const item of secondBody.media) {
      expect(firstIds.has(item.mediaId)).toBe(false);
    }
  });

  it("uses insertion cursor for missing mediaId cursor value", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const entryIds = [newSourceEntryId(), newSourceEntryId(), newSourceEntryId()];
    const mediaIds = [asMediaId("med_100"), asMediaId("med_200"), asMediaId("med_300")];

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

    for (let i = 0; i < entryIds.length; i += 1) {
      const sourceEntryId = entryIds[i];
      const mediaId = mediaIds[i];
      if (!sourceEntryId || !mediaId) {
        continue;
      }

      runtime.state.applyEvent(
        createEvent("SOURCE_ENTRY_UPSERTED", {
          entry: {
            sourceEntryId,
            sourceId,
            kind: "file",
            path: `C:/tmp/source/${i}.jpg`,
            size: 10 + i,
            mtimeMs: Date.now(),
            fingerprint: `${10 + i}:1:head-${i}`,
            lastSeenAt: Date.now(),
            state: "active"
          }
        })
      );
      runtime.state.applyEvent(
        createEvent("MEDIA_IMPORTED", {
          media: {
            mediaId,
            sha256: `${i}`.repeat(64),
            size: 10 + i,
            sourceEntryId
          }
        })
      );
      runtime.state.applyEvent(
        createEvent("MEDIA_METADATA_EXTRACTED", {
          mediaId,
          sourceEntryId,
          metadata: { kind: "photo", mimeType: "image/jpeg", takenAt: 100 + i }
        })
      );
    }

    const { baseUrl } = await startServer(runtime);
    const response = await fetch(`${baseUrl}/media/search?kind=photo&sort=mediaId_asc&limit=2&cursor=med_250`);
    const body = (await response.json()) as {
      media: Array<{ mediaId: string }>;
      total: number;
      nextCursor: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.media).toHaveLength(1);
    expect(body.media[0]?.mediaId).toBe("med_300");
    expect(body.nextCursor).toBeNull();
  });

  it("supports takenAt_desc cursor pagination with stable tie-breaker", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const entryIds = [newSourceEntryId(), newSourceEntryId(), newSourceEntryId()];
    const mediaIds = [asMediaId("med_100"), asMediaId("med_200"), asMediaId("med_300")];
    const takenAts = [200, 200, 100];

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

    for (let i = 0; i < entryIds.length; i += 1) {
      const sourceEntryId = entryIds[i];
      const mediaId = mediaIds[i];
      const takenAt = takenAts[i];
      if (!sourceEntryId || !mediaId || takenAt === undefined) {
        continue;
      }

      runtime.state.applyEvent(
        createEvent("SOURCE_ENTRY_UPSERTED", {
          entry: {
            sourceEntryId,
            sourceId,
            kind: "file",
            path: `C:/tmp/source/${i}.jpg`,
            size: 10 + i,
            mtimeMs: Date.now(),
            fingerprint: `${10 + i}:1:head-${i}`,
            lastSeenAt: Date.now(),
            state: "active"
          }
        })
      );
      runtime.state.applyEvent(
        createEvent("MEDIA_IMPORTED", {
          media: {
            mediaId,
            sha256: `${i}`.repeat(64),
            size: 10 + i,
            sourceEntryId
          }
        })
      );
      runtime.state.applyEvent(
        createEvent("MEDIA_METADATA_EXTRACTED", {
          mediaId,
          sourceEntryId,
          metadata: { kind: "photo", mimeType: "image/jpeg", takenAt }
        })
      );
    }

    const { baseUrl } = await startServer(runtime);
    const firstResponse = await fetch(`${baseUrl}/media/search?kind=photo&sort=takenAt_desc&limit=2`);
    const firstBody = (await firstResponse.json()) as {
      media: Array<{ mediaId: string }>;
      total: number;
      nextCursor: string | null;
    };

    expect(firstResponse.status).toBe(200);
    expect(firstBody.total).toBe(3);
    expect(firstBody.media.map((item) => item.mediaId)).toEqual(["med_100", "med_200"]);
    expect(firstBody.nextCursor).toBe("med_200");

    const secondResponse = await fetch(
      `${baseUrl}/media/search?kind=photo&sort=takenAt_desc&limit=2&cursor=med_200`
    );
    const secondBody = (await secondResponse.json()) as {
      media: Array<{ mediaId: string }>;
      total: number;
      nextCursor: string | null;
    };

    expect(secondResponse.status).toBe(200);
    expect(secondBody.total).toBe(3);
    expect(secondBody.media.map((item) => item.mediaId)).toEqual(["med_300"]);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("falls back to first page for missing cursor in takenAt_desc sort", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const entryIds = [newSourceEntryId(), newSourceEntryId(), newSourceEntryId()];
    const mediaIds = [asMediaId("med_100"), asMediaId("med_200"), asMediaId("med_300")];
    const takenAts = [300, 200, 100];

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

    for (let i = 0; i < entryIds.length; i += 1) {
      const sourceEntryId = entryIds[i];
      const mediaId = mediaIds[i];
      const takenAt = takenAts[i];
      if (!sourceEntryId || !mediaId || takenAt === undefined) {
        continue;
      }

      runtime.state.applyEvent(
        createEvent("SOURCE_ENTRY_UPSERTED", {
          entry: {
            sourceEntryId,
            sourceId,
            kind: "file",
            path: `C:/tmp/source/${i}.jpg`,
            size: 10 + i,
            mtimeMs: Date.now(),
            fingerprint: `${10 + i}:1:head-${i}`,
            lastSeenAt: Date.now(),
            state: "active"
          }
        })
      );
      runtime.state.applyEvent(
        createEvent("MEDIA_IMPORTED", {
          media: {
            mediaId,
            sha256: `${i}`.repeat(64),
            size: 10 + i,
            sourceEntryId
          }
        })
      );
      runtime.state.applyEvent(
        createEvent("MEDIA_METADATA_EXTRACTED", {
          mediaId,
          sourceEntryId,
          metadata: { kind: "photo", mimeType: "image/jpeg", takenAt }
        })
      );
    }

    const { baseUrl } = await startServer(runtime);
    const response = await fetch(`${baseUrl}/media/search?kind=photo&sort=takenAt_desc&limit=2&cursor=med_999`);
    const body = (await response.json()) as {
      media: Array<{ mediaId: string }>;
      total: number;
      nextCursor: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.media.map((item) => item.mediaId)).toEqual(["med_100", "med_200"]);
    expect(body.nextCursor).toBe("med_200");
  });

  it("supports takenAt_desc sort for media search", async () => {
    const runtime = createRuntime();
    const sourceId = newSourceId();
    const sourceEntryIdA = newSourceEntryId();
    const sourceEntryIdB = newSourceEntryId();
    const mediaIdA = newMediaId();
    const mediaIdB = newMediaId();

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
          sourceEntryId: sourceEntryIdA,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/a.jpg",
          size: 11,
          mtimeMs: Date.now(),
          fingerprint: "11:1:head-a",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: sourceEntryIdB,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/b.jpg",
          size: 12,
          mtimeMs: Date.now(),
          fingerprint: "12:1:head-b",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId: mediaIdA,
          sha256: "a".repeat(64),
          size: 11,
          sourceEntryId: sourceEntryIdA
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId: mediaIdB,
          sha256: "b".repeat(64),
          size: 12,
          sourceEntryId: sourceEntryIdB
        }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaIdA,
        sourceEntryId: sourceEntryIdA,
        metadata: { kind: "photo", mimeType: "image/jpeg", takenAt: 10 }
      })
    );
    runtime.state.applyEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaIdB,
        sourceEntryId: sourceEntryIdB,
        metadata: { kind: "photo", mimeType: "image/jpeg", takenAt: 20 }
      })
    );

    const { baseUrl } = await startServer(runtime);
    const response = await fetch(`${baseUrl}/media/search?kind=photo&sort=takenAt_desc&limit=2`);
    const body = (await response.json()) as { media: Array<{ mediaId: string }> };

    expect(response.status).toBe(200);
    expect(body.media).toHaveLength(2);
    expect(body.media[0]?.mediaId).toBe(mediaIdB);
    expect(body.media[1]?.mediaId).toBe(mediaIdA);
  });

  it("returns 400 for invalid sort", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/media/search?kind=photo&sort=unknown_sort`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_sort");
  });

  it("returns 400 when cursor and offset are passed together", async () => {
    const runtime = createRuntime();
    const { baseUrl } = await startServer(runtime);

    const response = await fetch(`${baseUrl}/media/search?kind=photo&cursor=media_1&offset=1`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_pagination_params");
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
