import { parseNativeSession } from "../auth/native-auth.js";
import { authHeaders } from "../auth/http.js";
import type { Env } from "../photos/env.js";

export async function handlePhotographerRequest(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/photographer/")) return null;
  const headers = authHeaders(request, env);
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const session = await parseNativeSession(request, env);
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (session.role !== "photographer") return json({ error: "forbidden" }, 403);
  try {
    if (path === "/api/photographer/photos" && request.method === "GET") {
      const photos = await env.DB.prepare(`SELECT id, album_id, status, created_at,
        CASE WHEN status='verified' AND approved_at IS NOT NULL THEN preview_url ELSE NULL END AS preview_url
        FROM photos WHERE photographer_id=? ORDER BY created_at DESC, id DESC LIMIT 100`)
        .bind(session.id).all();
      return json({ photos: photos.results });
    }
    return json({ error: "not_found" }, 404);
  } catch { return json({ error: "server_error" }, 500); }
}
