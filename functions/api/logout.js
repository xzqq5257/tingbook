// Cloudflare Pages Function: 管理员登出。清除 KV 会话 + Cookie。
import { destroySession, json, clearCookieHeader } from "../_lib/session.js";

export async function onRequestPost({ request, env }) {
  await destroySession(env, request);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookieHeader() });
}
