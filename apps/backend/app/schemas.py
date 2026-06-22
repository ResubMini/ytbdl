"""Pydantic 模型 —— 即 /v1/* 协议契约。

未来从 packages/protocol/openapi.yaml 自动生成，保持前后端类型一致。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class FormatInfo(BaseModel):
    format_id: str | None = None
    ext: str | None = None
    resolution: str | None = None
    vcodec: str | None = None
    acodec: str | None = None
    fps: float | None = None
    vbr: float | None = None
    abr: float | None = None
    tbr: float | None = None
    filesize: int | None = None
    filesize_approx: int | None = None
    language: str | None = None  # 音轨语言码，如 en/ja/es-419


class MediaInfo(BaseModel):
    id: str | None = None
    title: str | None = None
    url: str
    uploader: str | None = None
    duration: float | None = None
    thumbnail: str | None = None
    webpage_url: str | None = None
    ext: str | None = None
    is_live: bool | None = None
    is_playlist: bool = False
    playlist_count: int | None = None
    formats: list[FormatInfo] = Field(default_factory=list)
    audio_languages: list[str] = Field(default_factory=list)  # 可用音轨语言（去重）
    entries: list["MediaInfo"] | None = None  # 播放列表子项


MediaInfo.model_rebuild()


class DownloadRequest(BaseModel):
    url: str
    format: str | None = None  # yt-dlp 格式选择器，如 "bestvideo*+bestaudio/best"
    container: Literal["mp4", "webm"] | None = None
    format_has_audio: bool = False
    outtmpl: str | None = None  # 输出模板，None 用默认
    extract_audio: bool = False  # 提取音频（转 mp3/m4a 等）
    audio_format: str | None = None  # 提取音频时的目标编码，默认 mp3
    language: str | None = None  # 指定音轨语言（多音轨视频）
    extra_args: list[str] = Field(default_factory=list)  # 透传给 yt-dlp 的额外参数


class ConfigUpdate(BaseModel):
    download_dir: str | None = None
    max_concurrent: int | None = None
    default_format: str | None = None
    extract_audio: bool | None = None
    audio_format: str | None = None
    cookie_source: str | None = None
    cookie_browser: str | None = None
    cookie_profile: str | None = None
    cookie_profile_auto: bool | None = None
    cookie_file: str | None = None


class DownloadResponse(BaseModel):
    job_id: str


class JobProgress(BaseModel):
    downloaded_bytes: int | None = None
    total_bytes: int | None = None
    total_bytes_estimate: int | None = None
    speed: float | None = None
    eta: float | None = None
    elapsed: float | None = None
    fragment_index: int | None = None
    fragment_count: int | None = None


class Job(BaseModel):
    id: str
    url: str
    status: str  # queued | downloading | postprocessing | finished | error | cancelled
    title: str | None = None
    filename: str | None = None
    error: str | None = None
    created_at: float
    progress: JobProgress = Field(default_factory=JobProgress)
