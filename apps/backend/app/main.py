"""FastAPI sidecar 入口。

开发：python -m app.main
生产：Tauri 外壳以随机 PORT/TOKEN 拉起。
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import uvicorn
from fastapi import Depends, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .auth import require_token_header, require_token_query
from .browsers import detect as detect_browsers
from .config import CORS_ORIGINS, HOST, PORT, settings
from .engine import engine_info, sidecar_info
from .extract import extract
from .hub import hub
from .jobs import jobs
from .schemas import ConfigUpdate, DownloadRequest, DownloadResponse


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        from .cookies import cleanup_legacy_snapshots

        cleanup_legacy_snapshots()
        hub.bind_loop(asyncio.get_running_loop())
        yield

    app = FastAPI(title="ytbdl sidecar", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/v1/health")
    async def health(_: None = Depends(require_token_header)):
        return {"ok": True, **engine_info(), **sidecar_info()}

    @app.get("/v1/extract", response_model=None)
    async def extract_endpoint(url: str, _: None = Depends(require_token_header)):
        # 在线程池跑，避免阻塞事件循环
        return await asyncio.to_thread(extract, url)

    @app.post("/v1/download", response_model=DownloadResponse)
    async def download(req: DownloadRequest, _: None = Depends(require_token_header)):
        job_id = jobs.create(req)
        return DownloadResponse(job_id=job_id)

    @app.get("/v1/jobs")
    async def list_jobs(_: None = Depends(require_token_header)):
        return jobs.list_jobs()

    @app.get("/v1/jobs/{job_id}")
    async def get_job(job_id: str, _: None = Depends(require_token_header)):
        job = jobs.get(job_id)
        if not job:
            from fastapi import HTTPException, status
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
        return job

    @app.delete("/v1/jobs/{job_id}")
    async def cancel_job(job_id: str, _: None = Depends(require_token_header)):
        ok = jobs.cancel(job_id)
        return {"cancelled": ok}

    @app.post("/v1/jobs/{job_id}/retry")
    async def retry_job(job_id: str, _: None = Depends(require_token_header)):
        new_id = jobs.retry(job_id)
        if not new_id:
            from fastapi import HTTPException, status
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not retryable")
        return {"job_id": new_id}

    @app.post("/v1/jobs/{job_id}/remove")
    async def remove_job(job_id: str, _: None = Depends(require_token_header)):
        return {"removed": jobs.remove(job_id)}

    @app.get("/v1/config")
    async def get_config(_: None = Depends(require_token_header)):
        return settings.get()

    @app.put("/v1/config")
    async def put_config(cfg: ConfigUpdate, _: None = Depends(require_token_header)):
        data = cfg.model_dump(exclude_none=True)
        settings.update(**data)
        if "max_concurrent" in data:
            jobs.set_concurrency(settings.max_concurrent)
        return settings.get()

    @app.get("/v1/cookies/browsers")
    async def list_browsers(_: None = Depends(require_token_header)):
        return {"browsers": detect_browsers()}

    @app.get("/v1/cookies/profiles")
    async def list_profiles(browser: str, _: None = Depends(require_token_header)):
        from .browsers import profiles as detect_profiles
        return {"profiles": detect_profiles(browser)}

    @app.post("/v1/cookies/import")
    async def import_cookies(body: dict, _: None = Depends(require_token_header)):
        from .cookies import import_from_browser
        import time as _time

        browser = (body or {}).get("browser") or ""
        profile = (body or {}).get("profile") or ""
        if not browser:
            return JSONResponse(status_code=400, content={"ok": False, "error": "缺少 browser"})
        # 抽取可能较慢（解密 + 钥匙串），放线程池
        result = await asyncio.to_thread(import_from_browser, browser, profile)
        if result.get("ok"):
            settings.update(
                cookie_source="browser",
                cookie_browser=browser,
                cookie_profile=profile,
                cookie_profile_auto=not bool(profile),
                cookie_imported_at=int(_time.time()),
                cookie_imported_count=result.get("youtube_count", 0),
            )
        return {**result, "config": settings.get()}

    # ── 全局异常处理 ──
    # 任何端点抛异常都走这里，返回带 CORS 头的 JSON。
    # 关键：FastAPI 把 Exception handler 装在「最外层」(ServerErrorMiddleware)，
    # 它在 CORS 中间件之外，所以必须自行补 CORS 头，否则前端又见 "load failed"。
    # 全局 + 自补头 = 未来新增端点 / 换 yt-dlp 引擎都不会再犯。
    @app.exception_handler(Exception)
    async def _unhandled_exception(request: Request, exc: Exception):
        from .errors import friendly_error

        msg, needs_cookie = friendly_error(str(exc) or exc.__class__.__name__)
        headers = {}
        origin = request.headers.get("origin")
        if origin:
            headers["access-control-allow-origin"] = origin
            headers["access-control-allow-credentials"] = "true"
            headers["vary"] = "Origin"
        return JSONResponse(
            status_code=400 if needs_cookie else 500,
            content={"detail": msg, "needs_cookie": needs_cookie},
            headers=headers,
        )

    @app.websocket("/v1/events")
    async def events(ws: WebSocket, _: None = Depends(require_token_query)):
        await ws.accept()
        q = hub.subscribe()
        try:
            while True:
                event = await q.get()
                await ws.send_json(event)
        except WebSocketDisconnect:
            pass
        finally:
            hub.unsubscribe(q)

    return app


app = create_app()


def main() -> None:
    print(f"[ytbdl sidecar] listening on http://{HOST}:{PORT}  (token required)")
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
