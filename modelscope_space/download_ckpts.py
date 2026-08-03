#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建期预置 F5-TTS 权重到 /app/ckpts/<MODEL_TYPE>/。

作用：避免运行时首次合成才去下载权重，从而触发 ModelScope 反代
请求超时（返回 503、连接被掐断、模型永远加载不完）的结构性瓶颈。

为什么改从 hf-mirror 拉，而不是 ModelScope snapshot_download：
- 实测 ModelScope 的 `snapshot_download(allow_patterns=["ckpts/.../*"])` 在该仓库
  返回 "No files to download"（路径匹配不到），导致预置从未成功、运行时被迫临时下载被超时掐断。
- 而官方 HuggingFace 仓库 SWivid/F5-TTS 在 hf-mirror.com 上有**确定可下载**的权重文件
  （F5TTS_Base/model_1200000.safetensors 已实测 302 可达）。构建期不受反代超时限制，
  直接把它下载烤进镜像，运行时从本地 /app/ckpts 读取即可。
- E2TTS_Base 在 SWivid/F5-TTS 仓库不存在（实测 404），故默认用 F5TTS_Base。

若 hf-mirror 主源失败，会回退 modelscope 兜底（仍失败则仅告警不阻断；运行时 server 再兜底）。
"""
import os
import sys
import shutil
import urllib.request

MODEL_TYPE = os.environ.get("F5_MODEL_TYPE", "F5TTS_Base")
REPO_ID = "SWivid/F5-TTS"
FNAME = "model_1200000.safetensors"
DEST_DIR = f"/app/ckpts/{MODEL_TYPE}"
DEST_FILE = os.path.join(DEST_DIR, FNAME)


def _download(url, dst, timeout=900):
    """流式下载 url 到 dst，跟随重定向；返回是否成功。"""
    req = urllib.request.Request(url, headers={"User-Agent": "tingbook-build"})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(dst, "wb") as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    return True


def main():
    os.makedirs(DEST_DIR, exist_ok=True)
    # 1) 主源：hf-mirror 直链（构建期无反代超时，1.3GB 也能下完）
    url = f"https://hf-mirror.com/{REPO_ID}/resolve/main/{MODEL_TYPE}/{FNAME}"
    try:
        print(f"=== [build] 下载 {MODEL_TYPE} 权重 (hf-mirror): {url} ===", flush=True)
        _download(url, DEST_FILE)
        mb = os.path.getsize(DEST_FILE) / 1024 / 1024
        if mb < 10:
            # 文件过小（疑似错误页），判定失败
            os.remove(DEST_FILE)
            raise RuntimeError(f"下载文件过小 ({mb:.1f}MB)，疑似失败")
        print(f"[build] 权重已预置 -> {DEST_FILE}  ({mb:.1f} MB)", flush=True)
        return 0
    except Exception as e:
        print(f"[build] hf-mirror 下载失败: {e}", file=sys.stderr, flush=True)

    # 2) 兜底：modelscope（仅告警不阻断；运行时 server 还有 hf-mirror 兜底）
    try:
        from modelscope import snapshot_download
        d = snapshot_download(REPO_ID.replace("SWivid", "AI-ModelScope"), allow_patterns=[f"{MODEL_TYPE}/*"])
        src = os.path.join(d, MODEL_TYPE, FNAME)
        if os.path.isfile(src):
            shutil.copy(src, DEST_FILE)
            print(f"[build] 兜底 modelscope 预置 -> {DEST_FILE}", flush=True)
            return 0
    except Exception as e2:
        print(f"[build] modelscope 兜底失败: {e2}", file=sys.stderr, flush=True)
    print("[build] 权重预置未成功，运行时将兜底下载（可能较慢）", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
