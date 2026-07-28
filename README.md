# 倾听你的声音

用克隆人声朗读 22 篇古典诗文的**单文件离线 Web App**，部署在 GitHub Pages。

- 固定地址：`https://xzqq5257.github.io/tingbook/`（沙箱重启也不变，cloudflared 仅作备份）
- 体积：**29MB**（MP3 统一 64k 单声道内嵌，原 96k 版本为 44MB）
- 新增**封面 Hero**：渐变背景 + 程序化 SVG 声波，标题「倾听你的声音」
- 功能：书库点播、一键连播、同步字幕、倍速、定时关闭、**断点续播**（localStorage + IndexedDB 双后端，iOS 也能续播）
- 用法：手机浏览器打开上面的链接即可，无需联网、无需服务器（音频已内嵌）
- 进度记在手机浏览器本地；关掉重开底部出现「继续播放」小条，点一下接着听

## 本地重建

```bash
# 需先启动 :8000 的听书服务（提供 /api/library）
python3.11 build_single_html.py   # 输出 /workspace/倾听你的声音.html
```
