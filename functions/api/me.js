// Cloudflare Pages Function: 返回当前登录态。
// GET /api/me -> { authed: true, user } 或 { authed: false }
import { readSession, json } from "../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const s = await readSession(env, request);
  if (s) return json({ authed: true, user: s.user });
  return json({ authed: false });
}
