// Cloudflare Pages Function: 删除 photos/ 下的一个文件。
// body: { path: "photos/2026-08-19-xxx.jpg", sha: "<blob sha>", message?: "..." }
// 全站共享（不需鉴权，前端密码门已拦截）。
// 环境变量同 album-list.js：GH_TOKEN

const API = "https://api.github.com";
const OWNER = "xzqq5257";
const REPO = "tingbook";
const PREFIX = "photos/";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function bad(error, status = 400) {
  return json({ ok: false, error }, status);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const owner = (env.REPO_OWNER && env.REPO_OWNER.trim()) || OWNER;
  const repo = (env.REPO_NAME && env.REPO_NAME.trim()) || REPO;
  const token = (env.GH_TOKEN && env.GH_TOKEN.trim()) || "";
  if (!token) return bad("missing env: GH_TOKEN", 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return bad("bad json body", 400);
  }
  const path = (body && body.path) || "";
  const sha = (body && body.sha) || "";
  const message = (body && body.message) || "chore: delete album file";
  if (!path || !sha) return bad("path / sha 必填", 400);
  if (!path.startsWith(PREFIX)) return bad("仅可删除 photos/ 下的文件", 400);
  if (path.includes("..")) return bad("非法路径", 400);

  const r = await fetch(`${API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "tingbook-album",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ message, sha, branch: "main" }),
  });
  if (!r.ok) {
    const t = await r.text();
    return bad(`GitHub 删除失败: ${r.status} ${t.slice(0, 240)}`, r.status === 401 ? 500 : 502);
  }
  return json({ ok: true });
}

// 兼容：某些前端用 query ?path=&sha= 调 GET 也允许（用于老旧 HTML 客户端）
export async function onRequestGet(context) {
  const { request, env } = context;
  const owner = (env.REPO_OWNER && env.REPO_OWNER.trim()) || OWNER;
  const repo = (env.REPO_NAME && env.REPO_NAME.trim()) || REPO;
  const token = (env.GH_TOKEN && env.GH_TOKEN.trim()) || "";
  if (!token) return bad("missing env: GH_TOKEN", 500);
  const u = new URL(request.url);
  const path = u.searchParams.get("path") || "";
  const sha = u.searchParams.get("sha") || "";
  if (!path || !sha) return bad("path / sha 必填", 400);
  if (!path.startsWith(PREFIX)) return bad("仅可删除 photos/ 下的文件", 400);
  if (path.includes("..")) return bad("非法路径", 400);

  const r = await fetch(`${API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "tingbook-album",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ message: "chore: delete album file", sha, branch: "main" }),
  });
  if (!r.ok) {
    const t = await r.text();
    return bad(`GitHub 删除失败: ${r.status} ${t.slice(0, 240)}`, r.status === 401 ? 500 : 502);
  }
  return json({ ok: true });
}
