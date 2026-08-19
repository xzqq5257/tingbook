// Cloudflare Pages Function: 接收用户上传的照片 / 视频，转交到 GitHub 仓库 xzqq5257/tingbook 的 photos/ 目录。
// 全站共享（不需鉴权）：前端密码门已经在站外拦截了未授权访客。
//
// 流程：
//  1. multipart 读取 'file'
//  2. 校验大小（照片 ≤ 15MB、视频 ≤ 50MB）
//  3. 校验 mime (image/* 或 video/*)
//  4. 命名：photos/YYYY-MM-DD-<sha4 短码>.<ext>（按 SHA1 前 4 字节转 hex，足够防冲突）
//  5. b64 编码后用 Contents API PUT 到 main
//
// 限制：
//   - Cloudflare Pages Functions body 上限 ~50MB（免费层），所以视频限制 50MB
//   - 文件落到 GitHub 后，仓库大小应该不会爆炸（一般"几百张照片+少量短视频"远不到 GB 级）
//
// 环境变量：
//   GH_TOKEN      fine-grained PAT（需 Contents 写权限）
//   可选：REPO_OWNER / REPO_NAME 覆盖默认值

const API = "https://api.github.com";
const OWNER = "xzqq5257";
const REPO = "tingbook";
const PREFIX = "photos/";

const MAX_PHOTO = 15 * 1024 * 1024; // 15 MB
const MAX_VIDEO = 50 * 1024 * 1024; // 50 MB

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
    "Content-Type": "application/json",
    "User-Agent": "tingbook-album",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function sha1Hex(bytes) {
  // Web Crypto SHA-1，浏览器 / Cloudflare Workers 都支持
  return crypto.subtle.digest("SHA-1", bytes).then((d) => {
    const a = new Uint8Array(d);
    let s = "";
    for (let i = 0; i < 8; i++) s += a[i].toString(16).padStart(2, "0");
    return s;
  });
}

function ymd() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function extOf(name) {
  const m = /\.([^.]+)$/.exec(name || "");
  return m ? m[1].toLowerCase() : "bin";
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const owner = (env.REPO_OWNER && env.REPO_OWNER.trim()) || OWNER;
  const repo = (env.REPO_NAME && env.REPO_NAME.trim()) || REPO;
  const token = (env.GH_TOKEN && env.GH_TOKEN.trim()) || "";
  if (!token) return bad("missing env: GH_TOKEN", 500);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return bad("bad form data", 400);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return bad("no file", 400);

  const type = file.type || "";
  const isImg = type.startsWith("image/");
  const isVid = type.startsWith("video/");
  if (!isImg && !isVid) return bad("仅支持图片 / 视频", 400);

  const limit = isImg ? MAX_PHOTO : MAX_VIDEO;
  if (file.size > limit) {
    return bad(
      `${isImg ? "照片" : "视频"}超过 ${limit / 1024 / 1024}MB 限制（实际 ${(file.size / 1024 / 1024).toFixed(2)}MB）`,
      400
    );
  }

  const buf = await file.arrayBuffer();
  const hash4 = await sha1Hex(buf);
  const ext = extOf(file.name) || (isImg ? "jpg" : "mp4");
  const base = (file.name || "photo")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\-一-龥_.]/g, "_")
    .slice(0, 32) || "photo";
  const filename = `${PREFIX}${ymd()}-${base}-${hash4}.${ext}`;
  const content = b64(buf);

  // 检查同名是否已存在（短码冲突概率极小，撞上时用 sha 覆盖式更新）
  let existingSha = null;
  try {
    const check = await fetch(`${API}/repos/${owner}/${repo}/contents/${filename}`, {
      headers: auth(token),
    });
    if (check.ok) {
      const j = await check.json();
      existingSha = j.sha;
    }
  } catch {}

  const body = {
    message: `album: add ${file.name || "media"}`,
    content,
    branch: "main",
  };
  if (existingSha) body.sha = existingSha;

  let tries = 0;
  let lastErr = null;
  while (tries < 3) {
    tries++;
    const r = await fetch(`${API}/repos/${owner}/${repo}/contents/${filename}`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const j = await r.json();
      const name = filename.slice(PREFIX.length);
      return json({
        ok: true,
        file: {
          name,
          path: filename,
          size: file.size,
          sha: j.content && j.content.sha,
          type: isImg ? "image" : "video",
          rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/${filename}`,
          htmlUrl: j.content ? j.content.html_url : "",
        },
      });
    }
    const t = await r.text();
    lastErr = t.slice(0, 240);
    if (r.status === 409) {
      // 冲突：等一会儿重试一次（罕见）
      await new Promise((rr) => setTimeout(rr, 400));
      continue;
    }
    if (r.status >= 500) {
      await new Promise((rr) => setTimeout(rr, 600 * tries));
      continue;
    }
    return bad(`GitHub 拒绝: ${r.status} ${lastErr}`, r.status === 401 ? 500 : 502);
  }
  return bad("GitHub 多次失败：" + (lastErr || ""), 502);
}
