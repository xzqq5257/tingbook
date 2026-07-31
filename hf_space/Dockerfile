# Tingbook F5-TTS Voice Server —— HuggingFace Space (Docker SDK)
# 部署：把本目录内容（含 server.py / requirements.txt）推到 HF Space 仓库即可。
FROM python:3.11-slim

WORKDIR /app

# 系统依赖（soundfile / f5-tts 需要 libsndfile）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 模型权重与 vocoder 会在首次启动时按需自动下载（F5TTS_Base + vocos）。
# 参考音在启动时从 GitHub raw 自动拉取；换声后调用 POST /refresh-ref 即可热更新。
EXPOSE 8000
CMD ["python", "server.py"]
