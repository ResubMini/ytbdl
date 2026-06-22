"""引擎(yt-dlp)信息。

P0：直接 import 已安装的 yt_dlp。
未来：优先从 engines/ 加载可热替换的版本，import 作为兜底。
"""
from __future__ import annotations

import os

import yt_dlp
from yt_dlp.version import __version__ as YTDLP_VERSION

from . import __version__ as SIDECAR_VERSION


def engine_info() -> dict:
    """返回引擎版本/通道/来源路径。"""
    return {
        "name": "yt-dlp",
        "version": YTDLP_VERSION,
        "channel": getattr(yt_dlp.version, "CHANNEL", "stable"),
        "release_git_head": getattr(yt_dlp.version, "RELEASE_GIT_HEAD", None),
        "source": "import",  # 未来可能为 "engines/<path>"
    }


def sidecar_info() -> dict:
    return {"sidecar_version": SIDECAR_VERSION}


def runtime_ydl_opts() -> dict:
    deno = os.environ.get("SIDECAR_DENO")
    return {"js_runtimes": {"deno": {"path": deno} if deno else {}}}
