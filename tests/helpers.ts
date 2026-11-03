import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { vi } from "vitest";
import type { Env } from "../src/server/photos/env.js";

export function testEnvironment() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of [
    "0001_baseline.sql",
    "0002_photo_pipeline.sql",
    "0003_delivery_ledger.sql",
    "0004_face_whatsapp_maintenance.sql",
    "0005_users_auth_admin.sql",
    "0006_access_and_commission_versions.sql",
  ]) {
    sqlite.exec(
      readFileSync(
        new URL(`../src/server/db/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  }
  const execute = (sql: string, bindings: (string | number | null)[]) => {
    const expanded: (string | number | null)[] = [];
    const normalized = sql.replace(/\?(\d+)/g, (_, i: string) => {
      expanded.push(bindings[Number(i) - 1]);
      return "?";
    });
    return {
      stmt: sqlite.prepare(normalized),
      params: expanded.length ? expanded : bindings,
    };
  };
  const statement = (
    sql: string,
    bindings: (string | number | null)[] = [],
  ) => ({
    bind: (...values: (string | number | null)[]) => statement(sql, values),
    first: async () => {
      const { stmt, params } = execute(sql, bindings);
      return stmt.get(...params) ?? null;
    },
    all: async () => {
      const { stmt, params } = execute(sql, bindings);
      return { results: stmt.all(...params), success: true };
    },
    run: async () => {
      const { stmt, params } = execute(sql, bindings);
      return { success: true, meta: { changes: stmt.run(...params).changes } };
    },
  });
  let pending: Promise<unknown> = Promise.resolve();
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: (statements: { run: () => Promise<unknown> }[]) => {
      const result = pending.then(async () => {
        sqlite.exec("BEGIN");
        try {
          const results = [];
          for (const stmt of statements) results.push(await stmt.run());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      });
      pending = result.catch(() => {});
      return result;
    },
  };
  const objects = new Map<
    string,
    {
      bytes: Uint8Array;
      etag: string;
      httpMetadata: { contentType: string };
      customMetadata?: unknown;
      uploaded: Date;
    }
  >();
  let revision = 0;
  const put = vi.fn(
    async (
      key: string,
      value: Uint8Array,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: unknown;
      },
    ) => {
      const object = {
        bytes: Uint8Array.from(value),
        etag: `etag-${++revision}`,
        uploaded: new Date(),
        httpMetadata: {
          contentType:
            options?.httpMetadata?.contentType ?? "application/octet-stream",
        },
        customMetadata: options?.customMetadata,
      };
      objects.set(key, object);
      return object;
    },
  );
  const bucket = {
    put,
    list: vi.fn(
      async (options: { prefix: string; limit: number; cursor?: string }) => {
        const candidates = [...objects]
          .filter(
            ([key]) =>
              key.startsWith(options.prefix) &&
              (!options.cursor || key > options.cursor),
          )
          .sort(([a], [b]) => a.localeCompare(b));
        const selected = candidates.slice(0, options.limit);
        return {
          objects: selected.map(([key, value]) => ({
            key,
            ...value,
            size: value.bytes.length,
          })),
          truncated: candidates.length > selected.length,
          ...(candidates.length > selected.length
            ? { cursor: selected.at(-1)![0] }
            : {}),
        };
      },
    ),
    head: vi.fn(async (key: string) => {
      const object = objects.get(key);
      return object ? { ...object, size: object.bytes.length } : null;
    }),
    get: vi.fn(
      async (key: string, options?: { onlyIf?: { etagMatches?: string } }) => {
        const object = objects.get(key);
        if (!object) return null;
        const meta = { ...object, size: object.bytes.length };
        if (
          options?.onlyIf?.etagMatches &&
          options.onlyIf.etagMatches !== object.etag
        )
          return meta;
        return {
          ...meta,
          body: new Response(Uint8Array.from(object.bytes)).body!,
        };
      },
    ),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
  };
  const queue = {
    send: vi.fn(async () => {}),
    sendBatch: vi.fn(async () => {}),
  };
  const env = {
    NATIVE_AUTH_SECRET: "native-test-secret-32-bytes-or-longer",
    DB: db,
    PHOTOS: bucket,
    PHOTO_QUEUE: queue,
    R2_ACCOUNT_ID: "account",
    R2_BUCKET_NAME: "private",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    AUTH_JWKS_URL: "https://auth.example.test/jwks",
    AUTH_ISSUER: "https://auth.example.test",
    AUTH_AUDIENCE: "studio",
    MEDIA_SERVICE_URL: "https://media.example.test/process",
    MEDIA_SERVICE_TOKEN: "secret".repeat(8),
  } as unknown as Env;
  sqlite
    .prepare("INSERT INTO albums (id, photographer_id, title) VALUES (?, ?, ?)")
    .run("album-1", "owner", "Corrida");
  return { sqlite, env, bucket, queue, objects };
}

export const owner = async () => ({ id: "owner" });
export function post(path: string, body: unknown) {
  return new Request(
    `https://fotoviva.test/api/fotoviva/studio/photos/${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
