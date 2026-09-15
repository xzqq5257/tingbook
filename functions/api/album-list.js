// Cloudflare Pages Function: 列出相册照片（photos/）。
// 直接读同站静态清单 photos/manifest.json（由仓库 tree 生成后提交），
// 不再依赖 GitHub API / GH_TOKEN —— 避免 token 过期、CF 出口限流导致的 401/500。
// 刷新相册：增删 photos/ 下的图后，重新生成并提交 photos/manifest.json 即可。

const PREFIX = "photos/";
const OWNER = "xzqq5257";
const REPO = "tingbook";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function bad(error, status = 400) {
  return json({ ok: false, error }, status);
}
function classify(name) {
  const lower = name.toLowerCase();
  if (/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/.test(lower)) return "image";
  if (/\.(mp4|webm|mov|m4v|3gp)$/.test(lower)) return "video";
  return "other";
}

export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  try {
    const r = await fetch(`${origin}/photos/manifest.json`);
    if (!r.ok) return bad("清单读取失败: " + r.status, 500);
    const list = await r.json();
    const files = (Array.isArray(list) ? list : [])
      .map((it) => {
        const name = it.name || (it.path || "").slice(PREFIX.length);
        const type = it.type || classify(name);
        const path = it.path || PREFIX + name;
        if (type === "other") return null;
        return {
          name,
          path,
          size: it.size || 0,
          sha: it.sha || "",
          type,
          rawUrl: `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${path}`,
          proxyUrl: `/api/img?path=${encodeURIComponent(path)}`,
          htmlUrl: `https://github.com/${OWNER}/${REPO}/blob/main/${path}`,
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
