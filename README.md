# ytbdl

跨平台 yt-dlp 桌面客户端（Windows / macOS / Linux）。前后端解耦，yt-dlp 引擎可随时热更新、不影响前端；预留登录/收费。

> 架构详见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。`yt-dlp/` 目录仅为上游源码参考，不属于本项目。

## 结构

```
apps/desktop   # Tauri 2 + React + TS + Tailwind + shadcn/ui
apps/backend   # Python FastAPI sidecar（import yt_dlp）
packages/protocol  # OpenAPI 协议（单一事实来源）
docs/          # 架构文档
```

## 开发

### 后端（sidecar）
```bash
cd apps/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.main           # 监听 127.0.0.1:8765
```

### 前端（desktop）
```bash
cd apps/desktop
pnpm install
pnpm tauri dev               # 同时拉起 sidecar（P0 接入后）
```

## 状态
P0：端到端最小闭环实现中。
