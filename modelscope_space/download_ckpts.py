#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建期预置 F5-TTS 权重到 /app/ckpts/<MODEL_TYPE>/。

作用：避免运行时首次合成才去下载权重，从而触发 ModelScope 反代
请求超时（返回 503、连接被掐断、模型永远加载不完）的结构性瓶颈。

说明：
- 默认模型类型 E2TTS_Base（约 360MB，免费 CPU 实例可跑）；如需更高音质，
  可在环境变量 F5_MODEL_TYPE 指定 F5TTS_Base（约 1.3GB，需更高内存/GPU）。
- ModelScope 的 AI-ModelScope/F5-TTS 仓库根目录含一个 ckpts/ 顶层文件夹，
  snapshot_download 下载后结构是 <cache>/ckpts/<TYPE>/...，多嵌套一层；
  本脚本把权重**精准复制**到 server.py 期望的 /app/ckpts/<TYPE>/ 下，
  保证 _resolve_ckpt() 能直接命中。
- 若构建期下载失败（网络等），仅打印告警并以退出码 0 结束，不阻断镜像构建；
  运行时 server.py 仍会通过后台预热从 ModelScope 兜底下载。
"""
import os
import shutil
import sys

MODEL_TYPE = os.environ.get("F5_MODEL_TYPE", "E2TTS_Base")
REPO = "AI-ModelScope/F5-TTS"
ALLOW = [f"ckpts/{MODEL_TYPE}/*"]
DEST_DIR = f"/app/ckpts/{MODEL_TYPE}"
DEST_FILE = os.path.join(DEST_DIR, "model_1200000.safetensors")


def main():
    try:
        from modelscope import snapshot_download
    except Exception as e:
        print(f"[build] modelscope 不可用，跳过预置: {e}", file=sys.stderr, flush=True)
        return 0

    print(f"=== [build] 下载 {MODEL_TYPE} 权重（构建期预置）===", flush=True)
    try:
        d = snapshot_download(REPO, allow_patterns=ALLOW)
    except Exception as e:
        print(f"[build] 权重下载失败，运行时将兜底下载: {e}", file=sys.stderr, flush=True)
        return 0

    src_dir = os.path.join(d, "ckpts", "F5TTS_Base")
    if not os.path.isdir(src_dir):
        print(f"[build] 未找到 {src_dir}，运行时将兜底下载", file=sys.stderr, flush=True)
        return 0

    cands = [f for f in os.listdir(src_dir) if f.endswith((".safetensors", ".pt"))]
    if not cands:
        print("[build] 目录内无可识别权重文件，运行时将兜底下载", file=sys.stderr, flush=True)
        return 0

    # 优先 .safetensors（v1 之后的标准格式）
    cands.sort(key=lambda f: (f.endswith(".pt"), f))
    src = os.path.join(src_dir, cands[0])
    os.makedirs(DEST_DIR, exist_ok=True)
    shutil.copy(src, DEST_FILE)
    size_mb = os.path.getsize(DEST_FILE) / 1024 / 1024
    print(f"[build] 权重已预置 -> {DEST_FILE}  ({size_mb:.1f} MB)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
