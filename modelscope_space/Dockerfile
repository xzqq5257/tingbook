FROM python:3.10-slim
WORKDIR /home/user/app
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 ffmpeg && rm -rf /var/lib/apt/lists/*
COPY ./ /home/user/app
# pip 源：tuna 为主（本构建集群 DNS 可达、已验证可装 f5-tts，且下载速度正常）；
# 阿里云镜像作兜底（同属阿里云骨干，防 tuna 偶发空索引）。
# 重要：切勿使用 mirrors.modelscope.cn —— 该构建集群解析不到此主机（DNS 失败），
# 会让每个包都先空转数十秒重试，最终把构建拖超时。
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple --extra-index-url https://mirrors.aliyun.com/pypi/simple/
# 构建期预置权重到 /app/ckpts/F5TTS_Base（见 download_ckpts.py，从 hf-mirror 拉官方权重，约 1.3GB；运行实例 64GB 内存足够），避免运行时临时下载触发平台反代超时
RUN python download_ckpts.py
ENV F5_MODEL_TYPE=F5TTS_Base
ENV F5_PORT=7860
EXPOSE 7860
ENTRYPOINT ["python", "-u", "app.py"]
