"""下载任务管理器。

- 用 ThreadPoolExecutor 控制并发（P0 默认 2）
- progress_hooks / postprocessor_hooks → EventHub 广播
- 取消：设置 flag，在进度钩子里抛 DownloadError 中止
"""
from __future__ import annotations

import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from .config import settings
from .cookies import cookie_ydl_opts
from .hub import hub
from .schemas import DownloadRequest, JobProgress

# 状态机
QUEUED = "queued"
DOWNLOADING = "downloading"
POSTPROCESSING = "postprocessing"
FINISHED = "finished"
ERROR = "error"
CANCELLED = "cancelled"

OUTTMPL_NAME = "%(title).200B [%(id)s].%(ext)s"


class JobManager:
    def __init__(self) -> None:
        self._concurrency: int = settings.max_concurrent
        self._jobs: dict[str, dict] = {}
        self._cancel_flags: dict[str, bool] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=self._concurrency)

    # ---------- 查询 ----------
    def list_jobs(self) -> list[dict]:
        with self._lock:
            return [self._public(j) for j in self._jobs.values()]

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            j = self._jobs.get(job_id)
            return self._public(j) if j else None

    # ---------- 创建/取消 ----------
    def create(self, req: DownloadRequest) -> str:
        job_id = uuid.uuid4().hex[:12]
        job = {
            "id": job_id,
            "url": req.url,
            "status": QUEUED,
            "title": None,
            "filename": None,
            "error": None,
            "created_at": time.time(),
            "progress": {},
            "_req": req,  # 内部：供重试重放
        }
        with self._lock:
            self._jobs[job_id] = job
        hub.broadcast({"type": "job.created", "job_id": job_id, **self._public(job)})
        self._pool.submit(self._run, job_id, req)
        return job_id

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            j = self._jobs.get(job_id)
            if not j or j["status"] in (FINISHED, ERROR, CANCELLED):
                return False
            self._cancel_flags[job_id] = True
            j["status"] = CANCELLED
        hub.broadcast({"type": "job.cancelled", "job_id": job_id})
        return True

    def retry(self, job_id: str) -> str | None:
        """用原请求重放，创建一个新任务。"""
        with self._lock:
            j = self._jobs.get(job_id)
            if not j or "_req" not in j:
                return None
            req = j["_req"]
        return self.create(req)

    def remove(self, job_id: str) -> bool:
        """从列表移除任务记录（进行中的先取消）。不删磁盘文件。"""
        with self._lock:
            j = self._jobs.get(job_id)
            if not j:
                return False
            active = j["status"] in (QUEUED, DOWNLOADING, POSTPROCESSING)
            if active:
                self._cancel_flags[job_id] = True
            self._jobs.pop(job_id, None)
        hub.broadcast({"type": "job.removed", "job_id": job_id})
        return True

    def set_concurrency(self, n: int) -> None:
        """动态调整并发数。运行中的任务继续；排队中的任务重排到新池。"""
        n = max(1, int(n))
        if n == self._concurrency:
            return
        self._concurrency = n
        old = self._pool
        self._pool = ThreadPoolExecutor(max_workers=n)
        old.shutdown(wait=False, cancel_futures=True)
        with self._lock:
            queued = [
                (jid, j["_req"])
                for jid, j in self._jobs.items()
                if j["status"] == QUEUED and "_req" in j
            ]
        for jid, req in queued:
            self._pool.submit(self._run, jid, req)

    # ---------- 执行 ----------
    def _run(self, job_id: str, req: DownloadRequest) -> None:
        download_dir = settings.download_dir
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "progress_hooks": [lambda d: self._on_download_progress(job_id, d)],
            "postprocessor_hooks": [lambda d: self._on_postprocess(job_id, d)],
            "outtmpl": req.outtmpl or str(Path(download_dir) / OUTTMPL_NAME),
        }
        # 格式 + 音轨语言选择
        fmt = req.format
        if req.language:
            lang = req.language
            if req.extract_audio:
                # 仅音频：直接锁定该语言的音轨
                fmt = f"bestaudio[language={lang}]/bestaudio"
            elif fmt and "+" not in fmt and "best" not in fmt:
                # 用户选了具体视频格式_id：该视频 + 指定语言音轨（带回退）
                fmt = f"{fmt}+bestaudio[language={lang}]/bestvideo*+bestaudio/best"
            else:
                # 预设：最佳视频 + 指定语言音轨
                fmt = f"bestvideo*+bestaudio[language={lang}]/best"
        elif fmt and "+" not in fmt and "/" not in fmt and "best" not in fmt:
            # 用户选了具体视频格式_id（纯视频DASH流）：补最佳音频 + 回退，避免没声音/格式不存在
            fmt = f"{fmt}+bestaudio/best"
        if fmt:
            ydl_opts["format"] = fmt
        # 提取音频：下载最佳音频后转码
        if req.extract_audio:
            ydl_opts.setdefault("format", "ba")
            ydl_opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": (req.audio_format or "mp3"),
                    "preferredquality": "0",
                }
            ]

        # 登录信息：借用浏览器 cookie 或 cookies.txt 文件（解析与下载共用）
        ydl_opts.update(cookie_ydl_opts())

        # ffmpeg：release 由外壳通过 SIDECAR_FFMPEG 指向打包的 ffmpeg；
        # dev 不设则用系统 PATH 里的 ffmpeg。
        ff = os.environ.get("SIDECAR_FFMPEG")
        if ff:
            ydl_opts["ffmpeg_location"] = (
                os.path.dirname(ff) if os.path.isfile(ff) else ff
            )

        self._set_status(job_id, DOWNLOADING)
        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(req.url, download=True)
            if self._cancel_flags.get(job_id):
                self._set_status(job_id, CANCELLED)
                return
            # 捕获标题
            if isinstance(info, dict) and info.get("title"):
                self._set_field(job_id, "title", info["title"])
            # 取最终文件名
            filename = self._resolve_final_filename(info)
            self._finish(job_id, filename)
        except DownloadError as e:
            if self._cancel_flags.get(job_id):
                self._set_status(job_id, CANCELLED)
            else:
                from .errors import friendly_error

                msg, _ = friendly_error(str(e))
                self._fail(job_id, msg)
        except Exception as e:  # noqa: BLE001
            from .errors import friendly_error

            msg, _ = friendly_error(f"{type(e).__name__}: {e}")
            self._fail(job_id, msg)

    # ---------- 钩子 ----------
    def _on_download_progress(self, job_id: str, d: dict) -> None:
        # 取消：在钩子里抛异常中止 yt-dlp
        if self._cancel_flags.get(job_id):
            raise DownloadError("Cancelled by user")

        status = d.get("status")
        if status == "downloading":
            prog = JobProgress(
                downloaded_bytes=d.get("downloaded_bytes"),
                total_bytes=d.get("total_bytes"),
                total_bytes_estimate=d.get("total_bytes_estimate"),
                speed=d.get("speed"),
                eta=d.get("eta"),
                elapsed=d.get("elapsed"),
                fragment_index=d.get("fragment_index"),
                fragment_count=d.get("fragment_count"),
            ).model_dump()
            self._update_progress(job_id, prog)
            hub.broadcast({"type": "job.progress", "job_id": job_id, "status": "downloading", **prog})
        elif status == "finished":
            fn = d.get("filename")
            if fn:
                self._set_field(job_id, "filename", fn)
            hub.broadcast({"type": "job.progress", "job_id": job_id, "status": "finished", "filename": fn})

    def _on_postprocess(self, job_id: str, d: dict) -> None:
        status = d.get("status")
        pp = d.get("postprocessor")
        if status == "started":
            self._set_status(job_id, POSTPROCESSING)
        hub.broadcast({"type": "job.postprocess", "job_id": job_id, "status": status, "postprocessor": pp})

    # ---------- 状态变更 ----------
    def _resolve_final_filename(self, info) -> str | None:
        if not isinstance(info, dict):
            return None
        rd = info.get("requested_downloads")
        if rd and isinstance(rd, list) and rd[0].get("filepath"):
            return rd[0]["filepath"]
        if info.get("filepath"):
            return info["filepath"]
        return None

    def _finish(self, job_id: str, filename: str | None) -> None:
        with self._lock:
            j = self._jobs.get(job_id)
            if not j:
                return
            j["status"] = FINISHED
            if filename:
                j["filename"] = filename
        hub.broadcast({"type": "job.finished", "job_id": job_id, "filename": filename, **self._public(self._jobs[job_id])})

    def _fail(self, job_id: str, error: str) -> None:
        self._set_status(job_id, ERROR, error=error)
        hub.broadcast({"type": "job.error", "job_id": job_id, "error": error})

    def _set_status(self, job_id: str, status: str, **fields) -> None:
        with self._lock:
            j = self._jobs.get(job_id)
            if not j:
                return
            j["status"] = status
            j.update(fields)
        hub.broadcast({"type": "job.status", "job_id": job_id, "status": status})

    def _set_field(self, job_id: str, key: str, value) -> None:
        with self._lock:
            j = self._jobs.get(job_id)
            if j:
                j[key] = value

    def _update_progress(self, job_id: str, prog: dict) -> None:
        with self._lock:
            j = self._jobs.get(job_id)
            if j:
                j["progress"] = prog

    # ---------- 序列化 ----------
    def _public(self, job: dict) -> dict:
        return {
            "id": job["id"],
            "url": job["url"],
            "status": job["status"],
            "title": job.get("title"),
            "filename": job.get("filename"),
            "error": job.get("error"),
            "created_at": job["created_at"],
            "progress": job.get("progress") or {},
        }


jobs = JobManager()
