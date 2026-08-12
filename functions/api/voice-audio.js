// Cloudflare Pages Function: 试听某个音色的参考音（需登录）。
// GET /api/voice-audio?id=xxx -> audio/wav
import { readSession, json } from "../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未配置 KV 存储（TINGBOOK_KV）" }, 500);
  const s = await readSession(env, request);
  if (!s) return json({ ok: false, error: "未登录" }, 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ ok: false, error: "缺少 id" }, 400);
  const b64 = await kv.get(`voice:audio:${id}`);
  if (!b64) return json({ ok: false, error: "无音频" }, 404);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: { "content-type": "audio/wav", "cache-control": "no-store" },
  });
}
