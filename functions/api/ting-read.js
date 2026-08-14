// Cloudflare Pages Function: 听我读·克隆音 的代理。
// 前端把要朗读的文本 POST 到这里 -> 我们转发到阿里云百炼 Model Studio 的
// CosyVoice v3.5 语音合成服务，再把合成好的音频（wav）原样返回给浏览器播放。
//
// 流程：
//   1) 首次调用：用存放在 listen-to-your-voice/ltyv_reference.wav 的参考音
//      在阿里云百炼注册一个 CosyVoice v3.5 音色（一次免费），拿到 voice_id 后
//      缓存到 TINGBOOK_KV（key: cosyvoice:voice_id），后续请求直接复用。
//   2) 每次朗读：传 text + voice_id 调 SpeechSynthesizer，把返回的音频
//      原样转发给前端。
//
// 需要的 Cloudflare 环境变量（Dashboard -> Settings -> Environment variables，Production + Preview 都设）：
//   ALIYUN_BAILIAN_API_KEY   用户的百炼 API Key（sk-ws-... 开头）
//   ALIYUN_WORKSPACE_ID      业务空间 ID（ws-... 开头）
// 可选：
//   COSYVOICE_REF_URL        参考音的公网 URL（默认 https://tingbook.pages.dev/listen-to-your-voice/ltyv_reference.wav）
//   COSYVOICE_PREFIX         音色名前缀（默认 wuyongss）
//   COSYVOICE_MODEL          模型名（默认 cosyvoice-v3.5-plus，可改 cosyvoice-v3.5-flash）
//
// 已存在的依赖：
//   wrangler.toml 里 [[kv_namespaces]] binding="TINGBOOK_KV" 已绑好，
//   用于缓存 voice_id（避免每次注册）。
//
// 安全提示：本接口对全站访客开放（前端必须能调用）。API Key 只放在 Cloudflare 环境变量，
// 绝不进前端代码、不进 git。
export const onRequestPost = async ({ request, env }) => {
  const apiKey = (env.ALIYUN_BAILIAN_API_KEY || "").trim();
  const wsId = (env.ALIYUN_WORKSPACE_ID || "").trim();
  if (!apiKey) return json({ ok: false, error: "未配置 ALIYUN_BAILIAN_API_KEY 环境变量（请在 Cloudflare Pages 后台添加百炼 API Key）" }, 500);
  if (!wsId) return json({ ok: false, error: "未配置 ALIYUN_WORKSPACE_ID 环境变量（请在 Cloudflare Pages 后台添加百炼业务空间 ID）" }, 500);

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }
  const text = (body.text || "").trim();
  if (!text) return json({ ok: false, error: "缺少 text 字段" }, 400);

  // 1) 拿 voice_id（优先从 KV 读，没有就注册一次）
  let voiceId = null;
  if (env.TINGBOOK_KV) {
    try { voiceId = await env.TINGBOOK_KV.get("cosyvoice:voice_id"); } catch (e) { /* 忽略，回落到注册 */ }
  }
  if (!voiceId) {
    try {
      voiceId = await enrollVoice(apiKey, wsId, env);
    } catch (e) {
      return json({ ok: false, error: "音色注册失败：" + (e.message || String(e)) }, 502);
    }
    if (voiceId && env.TINGBOOK_KV) {
      try {
        // 缓存 1 年。百炼文档说"1 年没用会自动删音色"——这里反着，永远不主动删 KV，
        // 即使服务端删了，下次启动也会重新注册。
        await env.TINGBOOK_KV.put("cosyvoice:voice_id", voiceId, { expirationTtl: 60 * 60 * 24 * 365 });
      } catch (e) { /* 忽略，下次再注册 */ }
    }
  }
  if (!voiceId) return json({ ok: false, error: "无法获取 CosyVoice voice_id" }, 502);

  // 2) 合成语音
  try {
    const audio = await synthesize(apiKey, wsId, env, voiceId, text);
    return new Response(audio, {
      status: 200,
      headers: {
        "content-type": "audio/wav",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return json({ ok: false, error: "语音合成失败：" + (e.message || String(e)) }, 502);
  }
};

// 在阿里云百炼注册一个 CosyVoice v3.5 音色，返回 voice_id
async function enrollVoice(apiKey, wsId, env) {
  const refUrl = (env.COSYVOICE_REF_URL || "https://tingbook.pages.dev/listen-to-your-voice/ltyv_reference.wav").trim();
  const prefix = (env.COSYVOICE_PREFIX || "wuyongss").trim().slice(0, 16);
  const model = (env.COSYVOICE_MODEL || "cosyvoice-v3.5-plus").trim();
  const url = `https://${wsId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`;
  const ctrl = new AbortController();
  const to = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 120000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voice-enrollment",
        input: {
          action: "create_voice",
          target_model: model,
          prefix: prefix,
          url: refUrl,
        },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`enroll HTTP ${r.status} - ${txt.slice(0, 200)}`);
    }
    const j = await r.json();
    const id = j && j.output && j.output.voice_id;
    if (!id) throw new Error("enroll 返回没有 voice_id：" + JSON.stringify(j).slice(0, 200));
    return id;
  } catch (e) {
    clearTimeout(to);
    throw e;
  }
}

// 用 voice_id 合成语音，返回 wav 二进制（ArrayBuffer）
async function synthesize(apiKey, wsId, env, voiceId, text) {
  const model = (env.COSYVOICE_MODEL || "cosyvoice-v3.5-plus").trim();
  const url = `https://${wsId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`;
  const body = {
    model,
    input: {
      text: text.slice(0, 2000),
      voice: voiceId,
      format: "wav",
      sample_rate: 24000,
    },
  };
  // 留个 FreeStyle 扩展口（前端暂未启用）
  if (typeof env.COSYVOICE_INSTRUCTIONS === "string" && env.COSYVOICE_INSTRUCTIONS.trim()) {
    body.input.instructions = env.COSYVOICE_INSTRUCTIONS.trim().slice(0, 200);
  }
  const ctrl = new AbortController();
  const to = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 120000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`synth HTTP ${r.status} - ${txt.slice(0, 200)}`);
    }
    // 注意：SpeechSynthesizer 返回的是 JSON，音频在 output.audio.url（OSS 临时地址）
    // 或 output.audio.data（base64），并不是直接的二进制流，必须解析后再取音频。
    const j = await r.json();
    const audio = j && j.output && j.output.audio;
    if (!audio) throw new Error("synth 返回没有 output.audio：" + JSON.stringify(j).slice(0, 200));
    // 1) 优先 base64 data
    if (audio.data) {
      const bin = atob(audio.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (bytes.byteLength < 200) throw new Error(`synth 返回空音频（${bytes.byteLength} 字节）`);
      return bytes.buffer;
    }
    // 2) 否则回源拉取 OSS url（http/https 均可）
    if (audio.url) {
      const a2 = await fetch(audio.url);
      if (!a2.ok) throw new Error(`回源拉取音频 HTTP ${a2.status}`);
      const buf = await a2.arrayBuffer();
      if (!buf || buf.byteLength < 200) throw new Error(`回源音频为空（${buf ? buf.byteLength : 0} 字节）`);
      return buf;
    }
    throw new Error("synth 返回的 output.audio 既没有 data 也没有 url：" + JSON.stringify(audio).slice(0, 200));
  } catch (e) {
    clearTimeout(to);
    throw e;
  }
}

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