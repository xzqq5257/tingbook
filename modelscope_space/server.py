#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
F5-TTS 运行时推理服务（听我读·克隆音 后端）。

可在两种环境运行：
  1) 本地（仓库内）：使用本地权重与参考音。
       python tts/server.py
  2) 云端（如 ModelScope 创空间）：权重优先用构建期预置的 /app/ckpts，
     缺失时按 model_type 自动下载；参考音经 REF_URL 从 GitHub raw 自动拉取。

依赖：仅标准库 + f5_tts / soundfile / numpy / modelscope。

接口：
    GET  /health      -> {"ok":true,"loaded":bool,"device":"cpu"}
    POST /generate    -> 音频 (audio/wav)
         body (JSON):
           text       (必填) 要合成的文本
           ref        (可选) listen-to-your-voice/ 下参考音文件名，默认 ltyv_reference.wav
           ref_text   (可选) 参考音的文本（提升克隆质量）
           nfe_step   (可选) 推理步数，默认 16（越快越糙，32 更稳）
           speed      (可选) 语速，默认 1.0
    POST /refresh-ref -> 从 REF_URL 重新拉取参考音（换声后无需重启）
    POST /prepare     -> 主动触发后台模型预热（立即返回，不等待）

环境变量：
    F5_PORT / F5_HOST     端口 / 地址（默认 8000 / 0.0.0.0，容器由 Dockerfile 覆盖为 7860）
    F5_CKPT               模型权重路径；缺失则按优先级查找本地 /app/ckpts -> ModelScope 下载
    F5_PRELOAD            是否在启动时后台预热模型（默认 1；设 0 关闭，恢复首次请求时加载）
    REF_DIR               参考音目录（默认 <repo>/listen-to-your-voice）
    REF_URL               参考音远程地址（默认本仓库 GitHub raw 的 ltyv_reference.wav）
"""
import json
import os
import re
import sys
import threading
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# 国内环境（ModelScope / 阿里云 / 本地）拉取 HuggingFace 权重时走镜像源，避免直连超时
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

PORT = int(os.environ.get("F5_PORT", "8000"))
HOST = os.environ.get("F5_HOST", "0.0.0.0")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, ".."))
REF_DIR = os.environ.get("REF_DIR") or os.path.join(REPO_ROOT, "listen-to-your-voice")
CKPT = os.environ.get("F5_CKPT") or ""
DEFAULT_REF = "ltyv_reference.wav"
# 模型类型：默认 E2TTS_Base（约 360MB，免费 CPU 实例可跑）；
# 若需更高音质可改 F5TTS_Base（约 1.3GB，需更高内存/GPU）。
MODEL_TYPE = os.environ.get("F5_MODEL_TYPE", "E2TTS_Base")
# 参考音远程地址（换声后前端上传会更新 GitHub 仓库同名文件；本服务可据此热更新）
REF_URL = os.environ.get("REF_URL") or (
    "https://raw.githubusercontent.com/xzqq5257/tingbook/main/"
    "listen-to-your-voice/ltyv_reference.wav"
)

_model = None
_model_lock = threading.Lock()
_loaded_event = threading.Event()   # 模型加载完成信号
_device = "cpu"


def _cuda_available():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def _try_modelscope_download():
    """运行时兜底：从 ModelScope 下载 E2TTS/F5 权重，返回 ckpt 路径或 None。"""
    try:
        from modelscope import snapshot_download
        d = snapshot_download("AI-ModelScope/F5-TTS")
        for sub in (MODEL_TYPE, "E2TTS_Base", "F5TTS_Base"):
            for ext in ("safetensors", "pt"):
                cand = os.path.join(d, "ckpts", sub, f"model_1200000.{ext}")
                if os.path.isfile(cand):
                    print(f"[f5-server] 权重 (ModelScope/{sub}): {cand}", flush=True)
                    return cand
    except Exception as e:
        print(f"[f5-server] modelscope 下载失败: {e}", file=sys.stderr, flush=True)
    return None


def _resolve_ckpt():
    """按优先级定位权重文件：环境变量 -> 构建期预置 /app/ckpts -> 运行时下载。"""
    # 1) 显式指定
    if CKPT and os.path.isfile(CKPT):
        return CKPT
    # 2) 构建期预置目录（Dockerfile 已把权重下到这里，避免运行时临时下载超时）
    for base in ("/app/ckpts", os.path.join(HERE, "ckpts")):
        for sub in (MODEL_TYPE, "E2TTS_Base", "F5TTS_Base"):
            for ext in ("safetensors", "pt"):
                cand = os.path.join(base, sub, f"model_1200000.{ext}")
                if os.path.isfile(cand):
                    print(f"[f5-server] 权重 (本地预置/{sub}): {cand}", flush=True)
                    return cand
    # 3) 兜底：运行时从 ModelScope 下载
    return _try_modelscope_download()


def get_model():
    """加载并缓存 F5TTS 模型（线程安全）。"""
    global _model, _device
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        from f5_tts.api import F5TTS
        _device = "cuda" if _cuda_available() else "cpu"
        ckpt = _resolve_ckpt()
        kwargs = dict(model_type=MODEL_TYPE, vocoder_name="vocos", device=_device)
        if ckpt:
            kwargs["ckpt_file"] = ckpt
            src = ckpt
        else:
            # 兜底：按 model_type 自动下载默认权重（HF 镜像 / ModelScope）
            src = f"auto-download (model_type={MODEL_TYPE})"
        print(f"[f5-server] loading {MODEL_TYPE} from {src} on {_device} ...", flush=True)
        _model = F5TTS(**kwargs)
        _loaded_event.set()
        print("[f5-server] model ready.", flush=True)
        return _model


def preload():
    """后台预热：在独立线程加载模型，避免阻塞主线程 / 平台健康检查。"""
    try:
        get_model()
    except Exception:
        print("[f5-server] 预热失败（首次请求时仍会重试加载）:", file=sys.stderr, flush=True)
        traceback.print_exc()


def resolve_ref(ref_name):
    """只允许 REF_DIR 内的参考音文件，防止路径穿越。"""
    if not ref_name:
        ref_name = DEFAULT_REF
    base = os.path.basename(ref_name)
    path = os.path.join(REF_DIR, base)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"参考音不存在: {base}")
    return path


def _ref_api_url():
    """由 REF_URL（raw.githubusercontent）推导 GitHub API contents 地址，避免 raw CDN 缓存导致换声延迟。"""
    m = re.search(r"raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)", REF_URL)
    if m:
        owner, repo, branch, path = m.groups()
        return f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}"
    return None


def download_ref_to(ref_name, url):
    """从 url 下载参考音到 REF_DIR（首次启动/热更新用）。

    优先走 GitHub API contents 接口（返回最新的 blob，无 raw CDN 缓存），
    失败时回退到 REF_URL（raw）。
    """
    os.makedirs(REF_DIR, exist_ok=True)
    dst = os.path.join(REF_DIR, ref_name)
    tmp = dst + ".tmp"
    api_url = _ref_api_url()
    # 1) 尝试 GitHub API（最新鲜）
    if api_url:
        try:
            req = urllib.request.Request(
                api_url, headers={"User-Agent": "tingbook-f5-server", "Accept": "application/vnd.github+json"}
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            import base64
            content = base64.b64decode(data["content"])
            with open(tmp, "wb") as f:
                f.write(content)
            os.replace(tmp, dst)
            print(f"[f5-server] ref saved (via API) -> {dst}", flush=True)
            return dst
        except Exception as e:
            print(f"[f5-server] API 拉取参考音失败，回退 raw: {e}", file=sys.stderr, flush=True)
    # 2) 回退 raw
    print(f"[f5-server] downloading ref {ref_name} <- {url}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "tingbook-f5-server"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        f.write(r.read())
    os.replace(tmp, dst)
    print(f"[f5-server] ref saved -> {dst}", flush=True)
    return dst


def ensure_ref(ref_name=DEFAULT_REF):
    """确保参考音存在：本地有则用本地，否则尝试从 REF_URL 拉取。"""
    path = os.path.join(REF_DIR, ref_name)
    if os.path.isfile(path):
        return path
    # 仅当 REF_URL 指向同一文件名时才用远程拉取（避免误覆盖）
    if REF_URL.rstrip("/").endswith(ref_name):
        try:
            return download_ref_to(ref_name, REF_URL)
        except Exception as e:
            raise FileNotFoundError(f"参考音缺失且远程拉取失败: {e}")
    raise FileNotFoundError(f"参考音不存在: {ref_name}")


def do_generate(payload):
    text = (payload.get("text") or "").strip()
    if not text:
        raise ValueError("缺少 text 字段")
    if len(text) > 2000:
        raise ValueError("text 过长（上限 2000 字）")

    # 等待后台预热完成（最多 50s，留余量给平台反向代理超时）。
    # 若部署后后台已加载完，这里立即通过；若恰好撞上加载中，等其完成。
    if not _loaded_event.is_set():
        _loaded_event.wait(timeout=50)
    if not _loaded_event.is_set():
        raise RuntimeError("模型仍在加载中，请 10 秒后重试（首次部署需加载约 360MB 权重）")

    ref_path = ensure_ref(payload.get("ref") or DEFAULT_REF)
    ref_text = payload.get("ref_text") or ""
    nfe_step = int(payload.get("nfe_step") or 16)
    speed = float(payload.get("speed") or 1.0)

    model = get_model()
    wav, sr, _ = model.infer(
        ref_audio=ref_path,
        ref_text=ref_text,
        gen_text=text,
        nfe_step=nfe_step,
        speed=speed,
    )
    import soundfile as sf
    import io
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, code, obj, extra=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_audio(self, wav_bytes):
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self._cors()
        self.send_header("Content-Length", str(len(wav_bytes)))
        self.end_headers()
        self.wfile.write(wav_bytes)

    def log_message(self, fmt, *args):
        sys.stderr.write("[f5-server] " + (fmt % args) + "\n")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path)
        if p.path.rstrip("/") in ("/health", ""):
            with _model_lock:
                loaded = _model is not None
            self._send_json(200, {"ok": True, "loaded": loaded, "device": _device})
            return
        self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        p = urlparse(self.path)
        route = p.path.rstrip("/")
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8"))
            except Exception as je:
                try:
                    payload = {"text": raw.decode("utf-8", "replace")}
                except Exception:
                    payload = {}
                sys.stderr.write(f"[f5-server] json parse failed ({je}); fallback\n")
        except Exception:
            self._send_json(400, {"ok": False, "error": "bad request body"})
            return

        if route == "/generate":
            try:
                wav = do_generate(payload)
                self._send_audio(wav)
            except RuntimeError as e:
                # 模型仍在加载中：友好提示，前端可稍后重试（而非整体失败）
                self._send_json(503, {"ok": False, "error": str(e), "retry": True})
            except Exception as e:
                tb = traceback.format_exc()
                sys.stderr.write(tb)
                msg = str(e)
                code = 400 if isinstance(e, (ValueError, FileNotFoundError)) else 500
                self._send_json(code, {"ok": False, "error": msg})
        elif route == "/prepare":
            # 主动触发后台预热（不阻塞返回）
            threading.Thread(target=preload, daemon=True).start()
            self._send_json(200, {"ok": True, "message": "preload triggered"})
        elif route == "/refresh-ref":
            try:
                if not REF_URL.rstrip("/").endswith(DEFAULT_REF):
                    self._send_json(400, {"ok": False, "error": "REF_URL 未指向默认参考音，无法热更新"})
                    return
                download_ref_to(DEFAULT_REF, REF_URL)
                self._send_json(200, {"ok": True, "ref": DEFAULT_REF})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
        else:
            self._send_json(404, {"ok": False, "error": "not found"})


def main():
    # 提前确认参考音（缺失则尝试从 GitHub 拉取；失败仅告警，不阻断启动）
    try:
        ensure_ref()
    except Exception as e:
        print(f"[f5-server] 警告：参考音不可用: {e}", file=sys.stderr)
    # 后台预热模型：先让服务起来（/health 立即可用，平台健康检查不超时），
    # 模型在后台线程加载。部署后几十秒即就绪，用户首次朗读不再卡在下载。
    preload_on = os.environ.get("F5_PRELOAD", "1") not in ("0", "false", "no")
    if preload_on:
        threading.Thread(target=preload, daemon=True).start()
        print("[f5-server] 后台预热模型已启动（部署后数十秒就绪）...", flush=True)
    srv = HTTPServer((HOST, PORT), Handler)
    print(f"[f5-server] listening on http://{HOST}:{PORT}  (ref_dir={REF_DIR})", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[f5-server] stopped.", flush=True)


if __name__ == "__main__":
    main()
