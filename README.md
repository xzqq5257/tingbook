# 倾听你的声音

用克隆人声朗读 22 篇古典诗文的听书 Web App，部署在 GitHub Pages。

- 固定地址：`https://xzqq5257.github.io/tingbook/`（沙箱重启也不变）
- **加载快**：HTML 仅 ~55KB，封面秒开；音频按需流式加载——点哪篇才下载哪篇（不再一次性下载 29MB）
- 功能：书库点播、一键连播、同步字幕、倍速、定时关闭、**断点续播**（localStorage + IndexedDB 双后端，iOS 也能续播）
- 用法：手机浏览器打开上面的链接即可；音频托管在 GitHub Pages，无需额外服务器

## 结构

```
index.html      # 超小页面（封面 + UI + 书库元数据）
audio/          # 22 个 64k 单声道 MP3，按需流式加载
```

## 本地重建

```bash
python3.11 build_stream_html.py   # 读取 /tmp/lib.json，输出到 pages 仓库的 index.html
cp /tmp/ting_mp3/*.mp3 <仓库>/audio/
```
