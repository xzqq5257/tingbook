// Cloudflare Pages Function: 听我读·克隆音 的代理。
// 前端把要朗读的文本 POST 到这里 -> 我们转发到真正运行 F5-TTS 的后端服务（F5_TTS_URL），
// 再把合成好的音频（wav）原样返回给浏览器播放。
//
// 为什么需要这一层：Cloudflare Pages 静态站无法运行 F5-TTS（需要 torch + 1.3GB 模型）。
// 因此 F5 推理服务要跑在「能运行 torch 的机器」上（你的 GPU 本机 / HuggingFace Space / 云 GPU），
// 并通过 F5_TTS_URL 这个环境变量暴露给本函数。这样：
//   - 前端只和同源的 /api/ting-read 通信（无 CORS、无跨域密钥泄露）；
//   - F5 服务的真实地址只存在于 Cloudflare 环境变量里，不进前端代码。
//
// 需要的 Cloudflare 环境变量（Dashboard -> Settings -> Environment variables，Production + Preview）：
//   F5_TTS_URL   例如 https://你的-f5服务地址  （末尾不要带斜杠）
//
// 安全提示：本接口对全站访客开放（否则网页端无法调用）。如需防滥用，可在前面加一层简单的速率限制或密钥。
export const onRequestPost = async ({ request, env }) => {
  const base = (env.F5_TTS_URL && env.F5_TTS_URL.trim());
  if (!base) {
    return json({ ok: false, error: "未配置 F5_TTS_URL 环境变量（请在 Cloudflare 配置指向可运行 F5-TTS 的服务）" }, 500);
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }
  const text = (body.text || "").trim();
  if (!text) {
    return json({ ok: false, error: "缺少 text 字段" }, 400);
  }
  const payloadObj = {
    text: text.slice(0, 2000),
    ref: body.ref || "",
    ref_text: body.ref_text || "",
    nfe_step: Number(body.nfe_step) || 16,
    speed: Number(body.speed) || 1.0,
  };

  // 若配置了音色仓库（KV）且存在「激活音色」，把该音色的参考音作为 ref_audio（base64）
  // 传给 F5，实现「用户选定音色」的克隆，而非依赖 F5 服务端固定参考音。
  const kv = env.TINGBOOK_KV;
  if (kv) {
    try {
      const activeId = await kv.get("voice:active");
      if (activeId) {
        const audioB64 = await kv.get(`voice:audio:${activeId}`);
        if (audioB64) {
          payloadObj.ref_audio = audioB64;
          payloadObj.ref = ""; // 不再让 F5 用服务端默认参考音
        }
      }
    } catch (e) {
      // 忽略：回退到 F5 默认参考音
    }
  }

  const payload = JSON.stringify(payloadObj);

  // 上游 F5 推理在 CPU 上可能很慢，给它一个上限；超时/异常都返回清晰 JSON，
  // 避免 Cloudflare 网关把请求拖到平台wall上限而返回空响应（前端会一直等 → 卡顿）。
  const ctrl = new AbortController();
  const to = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 38000);
  let upstream;
  try {
    upstream = await fetch(base.replace(/\/+$/, "") + "/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(to);
    return json({ ok: false, error: "上游 F5 服务不可达或无响应（" + (e && e.name === "AbortError" ? "超时" : e.message) + "）" }, 504);
  }
  clearTimeout(to);

  if (!upstream.ok) {
    let msg = "";
    try { msg = await upstream.text(); } catch (e) {}
    return json({ ok: false, error: "上游 F5 服务返回错误：" + msg.slice(0, 300) }, 502);
  }

  const buf = await upstream.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": "audio/wav",
      "cache-control": "no-store",
    },
  });
};

export const onRequest = (ctx) => {
  if (ctx.request.method === "POST") return onRequestPost(ctx);
  return json({ ok: false, error: "method not allowed，请使用 POST" }, 405);
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
