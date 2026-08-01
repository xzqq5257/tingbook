FROM python:3.10-slim
WORKDIR /home/user/app
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 ffmpeg && rm -rf /var/lib/apt/lists/*
COPY ./ /home/user/app
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
ENV F5_PORT=7860
EXPOSE 7860
ENTRYPOINT ["python", "-u", "app.py"]
