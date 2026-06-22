"""元数据提取 —— extract_info(download=False)。

这是 UI「粘贴链接 → 预览」的后端。
适配层：把 yt-dlp 的 info_dict 翻译成稳定的 /v1/* 结构。
"""
from __future__ import annotations

from yt_dlp import YoutubeDL

from .cookies import apply_cookie_jar, browser_cookie_jar, cookie_ydl_opts
from .engine import runtime_ydl_opts
from .schemas import FormatInfo, MediaInfo


def _resolution(f: dict) -> str | None:
    if f.get("resolution"):
        return f["resolution"]
    w, h = f.get("width"), f.get("height")
    if w and h:
        return f"{int(w)}x{int(h)}"
    if h:
        return f"{int(h)}p"
    return None


def _normalize_format(f: dict) -> FormatInfo:
    return FormatInfo(
        format_id=f.get("format_id"),
        ext=f.get("ext"),
        resolution=_resolution(f),
        vcodec=f.get("vcodec"),
        acodec=f.get("acodec"),
        fps=f.get("fps"),
        vbr=f.get("vbr"),
        abr=f.get("abr"),
        tbr=f.get("tbr"),
        filesize=f.get("filesize"),
        filesize_approx=f.get("filesize_approx"),
        language=f.get("language"),
    )


def _distinct_audio_languages(formats: list[FormatInfo]) -> list[str]:
    """从音频格式里提取去重的音轨语言（按偏好顺序）。"""
    langs: list[str] = []
    seen: set[str] = set()
    for f in formats:
        is_audio = (not f.vcodec or f.vcodec == "none") and bool(
            f.acodec and f.acodec != "none"
        )
        if is_audio and f.language and f.language not in seen:
            seen.add(f.language)
            langs.append(f.language)
    return langs


def _display_video_formats(formats: list[FormatInfo]) -> list[FormatInfo]:
    """把 yt-dlp 的内部变体压成用户可理解的画质列表。"""
    selected: dict[tuple, FormatInfo] = {}
    for fmt in formats:
        if (
            not fmt.format_id
            or fmt.ext not in ("mp4", "webm")
            or not fmt.resolution
            or not fmt.vcodec
            or fmt.vcodec in ("none", "images")
        ):
            continue
        key = (fmt.resolution, fmt.ext, round(fmt.fps or 0))
        score = (bool(fmt.filesize or fmt.filesize_approx), fmt.tbr or fmt.vbr or 0)
        current = selected.get(key)
        current_score = (
            bool(current and (current.filesize or current.filesize_approx)),
            (current.tbr or current.vbr or 0) if current else 0,
        )
        if current is None or score > current_score:
            selected[key] = fmt
    return list(selected.values())


def _normalize_entry(info: dict, url: str | None = None) -> MediaInfo:
    formats = [_normalize_format(f) for f in (info.get("formats") or [])]
    return MediaInfo(
        id=info.get("id"),
        title=info.get("title"),
        url=url or info.get("webpage_url") or info.get("original_url") or info.get("url"),
        uploader=info.get("uploader") or info.get("channel"),
        duration=info.get("duration"),
        thumbnail=info.get("thumbnail"),
        webpage_url=info.get("webpage_url"),
        ext=info.get("ext"),
        is_live=info.get("is_live"),
        formats=_display_video_formats(formats),
        audio_languages=_distinct_audio_languages(formats),
    )


def extract(url: str) -> MediaInfo:
    """提取元数据，不下载。返回标准化的 MediaInfo。"""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noprogress": True,
        "extract_flat": False,
    }
    ydl_opts.update(runtime_ydl_opts())
    ydl_opts.update(cookie_ydl_opts())
    with YoutubeDL(ydl_opts) as ydl:
        apply_cookie_jar(ydl, browser_cookie_jar())
        info = ydl.extract_info(url, download=False)

    is_playlist = isinstance(info, dict) and (
        info.get("_type") in ("playlist", "multi_video") or "entries" in info
    )

    if is_playlist:
        entries = []
        for e in (info.get("entries") or []):
            if not e:
                continue
            entries.append(_normalize_entry(e, url=e.get("webpage_url") or e.get("url")))
        return MediaInfo(
            id=info.get("id"),
            title=info.get("title"),
            url=url,
            is_playlist=True,
            playlist_count=info.get("playlist_count") or len(entries),
            entries=entries,
        )

    return _normalize_entry(info, url=url)
