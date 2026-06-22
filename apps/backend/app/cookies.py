"""cookie 管理：验证浏览器登录状态，使用时读取浏览器最新 cookie。"""
from __future__ import annotations

from yt_dlp.cookies import extract_cookies_from_browser

from .browsers import profiles
from .config import DATA_DIR, settings


def cleanup_legacy_snapshots() -> None:
    """旧版曾把全部浏览器 cookie 明文落盘；升级后立即删除。"""
    legacy_dir = DATA_DIR / "cookies"
    if legacy_dir.exists():
        for path in legacy_dir.glob("*.txt"):
            path.unlink(missing_ok=True)


def _youtube_count(jar) -> int:
    return sum(1 for cookie in jar if "youtube" in (cookie.domain or "").lower())


def _select_profile(browser: str, requested: str | None):
    """返回实际可用的 (profile, cookie jar, YouTube 数量)；空 requested 表示自动。"""
    candidates = [requested] if requested else [row["folder"] for row in profiles(browser)]
    if not candidates:
        candidates = [""]

    best = ("", None, 0)
    errors = []
    for profile in candidates:
        try:
            jar = extract_cookies_from_browser(browser, profile=profile or None)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
            continue
        current = (profile or "", jar, _youtube_count(jar))
        if current[2] > best[2]:
            best = current

    if best[2] == 0:
        detail = f"：{errors[0][:160]}" if errors else ""
        label = requested or "自动选择的账户"
        raise RuntimeError(f"{label} 未读取到 YouTube Cookie{detail}")
    return best


def import_from_browser(browser: str, profile: str | None) -> dict:
    """验证账户；空 Profile 时自动选择实际含 YouTube Cookie 的账户。"""
    try:
        resolved, jar, youtube_count = _select_profile(browser, profile)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:300], "count": 0, "youtube_count": 0}
    return {
        "ok": True,
        "error": None,
        "count": len(jar),
        "youtube_count": youtube_count,
        "resolved_profile": resolved,
    }


def cookie_ydl_opts() -> dict:
    """返回 cookie 相关的 yt-dlp 参数（解析与下载共用）。

    browser 模式：每次读取浏览器最新 cookie，跟上 YouTube 的 cookie 轮换。
    file 模式：用用户指定的 cookies.txt（高级选项）。
    """
    if settings.cookie_source == "file" and settings.cookie_file:
        return {"cookiefile": settings.cookie_file}
    return {}


def browser_cookie_jar():
    """每次操作只读取一次浏览器 Cookie，并仅保存在内存中。"""
    if settings.cookie_source != "browser" or not settings.cookie_browser:
        return None
    requested = "" if settings.cookie_profile_auto else settings.cookie_profile
    _, jar, _ = _select_profile(settings.cookie_browser, requested)
    return jar


def apply_cookie_jar(ydl, jar) -> None:
    if jar:
        for cookie in jar:
            ydl.cookiejar.set_cookie(cookie)
