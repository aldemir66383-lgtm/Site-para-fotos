import type { Env } from "./photos/env.js";
import { recoverPhotos } from "./photos/processing.js";
import { drainWhatsAppOutbox } from "./notifications/whatsapp.js";
import { indexPendingFaces } from "./search/face-index.js";

/** Bounded prefix scan, checkpointed across invocations. Never touches final originals. */
export async function cleanOrphanUploads(
  env: Env,
  now = Date.now(),
  pageLimit = 5,
) {
  const saved = await env.DB.prepare(
    "SELECT value FROM maintenance_state WHERE key='pending_scan_cursor'",
  ).first<{ value: string }>();
  let cursor = saved?.value || undefined;
  for (let page = 0; page < pageLimit; page++) {
    const listed = await env.PHOTOS.list({
      prefix: "originals/pending/",
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const object of listed.objects) {
      if (
        !object.key.startsWith("originals/pending/") ||
        object.uploaded.getTime() > now - 24 * 60 * 60_000
      )
        continue;
      const active = await env.DB.prepare(
        `SELECT photo_id FROM photo_uploads WHERE staging_key=? AND state IN ('pending','queued','processing')`,
      )
        .bind(object.key)
        .first();
      if (!active) await env.PHOTOS.delete(object.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
    await env.DB.prepare(
      `INSERT INTO maintenance_state(key,value) VALUES ('pending_scan_cursor',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
      .bind(cursor ?? "")
      .run();
    if (!cursor) break;
  }
}

export async function expireOrdersAndPrivateData(env: Env, now = Date.now()) {
  const iso = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE orders SET status='expired',updated_at=? WHERE status='pending' AND julianday(expires_at)<=julianday(?)",
    ).bind(iso, iso),
    env.DB.prepare(
      `UPDATE payment_charges SET status='expired',updated_at=? WHERE status='pending'
      AND (julianday(expires_at)<=julianday(?) OR EXISTS (SELECT 1 FROM orders WHERE id=payment_charges.order_id AND status='expired'))`,
    ).bind(iso, iso),
    env.DB.prepare("DELETE FROM search_sessions WHERE expires_at_ms<=?").bind(
      now,
    ),
    env.DB.prepare("DELETE FROM photo_face_index WHERE expires_at_ms<=?").bind(
      now,
    ),
    env.DB.prepare(
      "DELETE FROM photo_face_embeddings WHERE expires_at_ms<=?",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM face_search_consents WHERE expires_at_ms<=?",
    ).bind(now),
  ]);
}

export async function runScheduled(env: Env, cron: string) {
  const tasks = [recoverPhotos(env), drainWhatsAppOutbox(env)];
  if (cron === "*/10 * * * *")
    tasks.push(
      expireOrdersAndPrivateData(env),
      cleanOrphanUploads(env),
      indexPendingFaces(env),
    );
  const results = await Promise.allSettled(tasks);
  for (const [index, result] of results.entries())
    if (result.status === "rejected")
      console.error("maintenance_task_failed", { task: index });
}
