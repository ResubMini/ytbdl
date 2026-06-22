"""把 yt-dlp 的原始报错转成对用户友好的中文。

- 登录/反爬类错误 → 提示去「设置 → 登录信息」导入
- 其它错误 → 去掉 URL、去掉 ERROR: 前缀、截断
"""
from __future__ import annotations

import re

# 命中即视为「需要登录」类错误
_COOKIE_RE = re.compile(
    r"sign in to confirm|not a bot|cookie|log[ -]?in required|account required",
    re.IGNORECASE,
)
_URL_RE = re.compile(r"https?://\S+")
_ERR_PREFIX_RE = re.compile(r"^\s*ERROR:\s*", re.IGNORECASE)


def friendly_error(raw: str) -> tuple[str, bool]:
    """返回 (友好消息, 是否登录相关)。"""
    if not raw:
        return ("下载失败", False)

    if _COOKIE_RE.search(raw):
        return (
            "该网站需要登录验证（如 YouTube 的反爬限制）。"
            "请到「设置 → 登录信息」从浏览器导入登录信息后重试。",
            True,
        )

    cleaned = _URL_RE.sub("", raw)  # 去掉链接
    cleaned = _ERR_PREFIX_RE.sub("", cleaned)  # 去掉 ERROR: 前缀
    cleaned = cleaned.strip().strip("：:").strip()
    return (cleaned[:300] or "下载失败", False)
