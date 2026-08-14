// Cloudflare Pages Function: 接收用户上传的参考音，覆盖仓库 listen-to-your-voice/ltyv_reference.wav
// 部署后：「一键换声」按钮 -> POST /api/voice-source (multipart, file) -> 这里用服务端 GH_TOKEN 提交到 main。
// 随后 Cloudflare Pages 重新部署，「原声试听」即更新为新参考音；本地 tts/generate_all.py 也可据此重生成全部。
//
// 仅依赖 Cloudflare 环境变量（同 delete.js）：
//   GH_TOKEN      fine-grained PAT（仅授权 xzqq5257/tingbook 的 Contents 读写）
//   REPO_OWNER    xzqq5257
//   REPO_NAME     tingbook
//   ADMIN_KEY     与前端一致的暗号（默认 ltyv-del-2026）
//   F5_TTS_URL    可选：HF Space 的 F5 克隆音服务地址。配置后，上传参考音成功会自动
//                 调用该服务的 /refresh-ref，让「一键换声」一次到位（无需手动重启服务）。

const API = "https://api.github.com";

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function gh(token, method, path, data) {
  return fetch(API + path, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "tingbook-voice-src",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: data ? JSON.stringify(data) : undefined,
  });
}

async function tokenWorks(token, owner, repo) {
  if (!token) return false;
  try {
    const r = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/main`);
    return r.ok;
  } catch {
    return false;
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

// 解析 WAV 头获取时长（秒）；非 WAV 返回 null
function wavDuration(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.byteLength < 44) return null;
    const riff = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (riff !== "RIFF") return null;
    const channels = dv.getUint16(22, true);
    const sampleRate = dv.getUint32(24, true);
    const bits = dv.getUint16(34, true);
    let off = 12;
    while (off + 8 <= dv.byteLength) {
      const id = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
      const size = dv.getUint32(off + 4, true);
      if (id === "data") {
        const sec = size / (sampleRate * channels * (bits / 8));
        return isFinite(sec) ? Math.round(sec * 10) / 10 : null;
      }
      off += 8 + size + (size & 1);
    }
  } catch (e) {}
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const owner = (env.REPO_OWNER && env.REPO_OWNER.trim()) || "xzqq5257";
  const repo = (env.REPO_NAME && env.REPO_NAME.trim()) || "tingbook";
  const adminKey = (env.ADMIN_KEY && env.ADMIN_KEY.trim()) || "ltyv-del-2026";
  const token = (env.GH_TOKEN && env.GH_TOKEN.trim()) || "";

  if (!token) return json({ status: "error", error: "missing env: 请在 Cloudflare 环境变量配置 GH_TOKEN" }, 500);
  if (!(await tokenWorks(token, owner, repo)))
    return json({ status: "error", error: "GH_TOKEN 无效或无 xzqq5257/tingbook 仓库权限" }, 500);

  const provided = request.headers.get("x-admin-key") || "";
  if (provided !== adminKey) return json({ status: "error", error: "unauthorized" }, 401);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ status: "error", error: "bad form" }, 400);
  }
  const file = form.get("file");
  if (!file) return json({ status: "error", error: "no file" }, 400);

  const MAX = 20 * 1024 * 1024;
  if (file.size > MAX) return json({ status: "error", error: "文件过大（>20MB），请上传更短的参考音" }, 400);
  if (!/^audio\//.test(file.type || "")) return json({ status: "error", error: "仅支持音频文件（wav/mp3/m4a 等）" }, 400);

  const buf = await file.arrayBuffer();
  const content = b64(buf);
  const path = "listen-to-your-voice/ltyv_reference.wav";

  let sha = null;
  const getRes = await gh(token, "GET", `/repos/${owner}/${repo}/contents/${path}?ref=main`);
  if (getRes.ok) {
    const j = await getRes.json();
    if (j && j.sha) sha = j.sha;
  }
  const putBody = { message: "chore: update voice reference audio via web", content, branch: "main" };
  if (sha) putBody.sha = sha;
  const putRes = await gh(token, "PUT", `/repos/${owner}/${repo}/contents/${path}`, putBody);
  if (!putRes.ok) {
    const t = await putRes.text();
    return json({ status: "error", error: "GitHub 写入失败: " + t.slice(0, 140) }, 500);
  }

  const dur = wavDuration(buf);

  // 关键：上传新参考音后，让「克隆朗读」立即换成新音色——删除 KV 里缓存的百炼 voice_id，
  // 下次 /api/ting-read 合成时会用新的 ltyv_reference.wav 重新向百炼注册。否则克隆音会一直
  // 沿用旧参考音登记出来的那个 voice_id，用户「上传的参考音频」永远不生效。
  if (env.TINGBOOK_KV) {
    try { await env.TINGBOOK_KV.delete("cosyvoice:voice_id"); } catch (e) {}
  }

  // 若配置了 F5 服务地址，成功写入后自动通知其刷新参考音（换声一次到位）。
  // 此为尽力而为：通知失败不影响本次上传成功。
  let hfRefreshed = null;
  const f5url = (env.F5_TTS_URL && env.F5_TTS_URL.trim()) || "";
  if (f5url) {
    try {
      const r = await fetch(f5url.replace(/\/+$/, "") + "/refresh-ref", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const b = await r.json().catch(() => ({}));
      hfRefreshed = !!(r.ok && b.ok);
    } catch (e) {
      hfRefreshed = false; // 通知失败不阻断上传成功
    }
  }

  return json({ status: "ok", duration: dur, size: file.size, hfRefreshed });
}
