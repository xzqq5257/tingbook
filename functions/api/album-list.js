// Cloudflare Pages Function: 列出 GitHub 仓库 xzqq5257/tingbook 的 photos/ 目录内容。
// 全站共享（不需鉴权，因为整个站已经走前端密码门）。
// 环境变量同 voice-source.js：GH_TOKEN（fine-grained PAT, Contents 读权限足够）

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

function auth(token) {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "tingbook-album",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghGet(token, path, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(API + path, { headers: auth(token) });
      if (r.ok) return r;
      if (r.status === 404) return r;
      const t = await r.text();
      lastErr = `GH ${r.status}: ${t.slice(0, 200)}`;
      if (r.status >= 500) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      throw new Error(lastErr);
    } catch (e) {
      lastErr = String(e);
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error(lastErr);
}

function classify(name) {
  const lower = name.toLowerCase();
  if (/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/.test(lower)) return "image";
  if (/\.(mp4|webm|mov|m4v|3gp)$/.test(lower)) return "video";
  return "other";
}

async function readTree(token) {
  // 1) 看仓库是否存在 / 拉取顶层 tree
  const r = await ghGet(token, `/repos/${OWNER}/${REPO}/git/trees/main?recursive=1`);
  if (!r.ok) {
    if (r.status === 404) return [];
    throw new Error(`GH ${r.status}`);
  }
  const j = await r.json();
  return (j.tree || []).filter((it) => it.type === "blob" && it.path.startsWith(PREFIX));
}

export async function onRequestGet(context) {
  const { env } = context;
  const token = (env.GH_TOKEN && env.GH_TOKEN.trim()) || "";
  if (!token) return bad("missing env: GH_TOKEN", 500);
  try {
    const tree = await readTree(token);
    // 按上传时间倒序（git blob 没 mtime，按文件名日期前缀排序：2026-08-19-xxxx.jpg）
    const files = tree
      .map((it) => {
        const name = it.path.slice(PREFIX.length);
        const type = classify(name);
        if (type === "other") return null;
        return {
          name,
          path: it.path,
          size: it.size,
          sha: it.sha,
          type,
          rawUrl: `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${it.path}`,
          htmlUrl: `https://github.com/${OWNER}/${REPO}/blob/main/${it.path}`,
          isVideo: type === "video",
          isImage: type === "image",
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.name < b.name ? 1 : -1));
    return json({ ok: true, files });
  } catch (e) {
    return bad("list 失败：" + String(e.message || e), 500);
  }
}
