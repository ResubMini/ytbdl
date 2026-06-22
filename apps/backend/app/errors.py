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
# 格式不可用（已通过后端格式构造避免，留作兜底）
_FORMAT_RE = re.compile(r"format.*not available|requested format", re.IGNORECASE)
_URL_RE = re.compile(r"https?://\S+")
_ERR_PREFIX_RE = re.compile(r"^\s*ERROR:\s*", re.IGNORECASE)


def friendly_error(raw: str) -> tuple[str, bool]:
    """返回 (友好消息, 是否登录相关)。"""
    if not raw:
        return ("下载失败", False)

    if _COOKIE_RE.search(raw):
        return (
            "登录信息已失效（YouTube 的登录 cookie 过期了）。"
            "请到「设置 → 登录信息」重新点「导入登录信息」刷新，再重试。",
            True,
        )

    # 注意：bot-check 错误里有时带 "format" 字样，必须排在 cookie 判断之后
    if _FORMAT_RE.search(raw):
        return ("所选画质该视频不支持，请改选「自动最佳画质」后重试。", False)

    cleaned = _URL_RE.sub("", raw)  # 去掉链接
    cleaned = _ERR_PREFIX_RE.sub("", cleaned)  # 去掉 ERROR: 前缀
    cleaned = cleaned.strip().strip("：:").strip()
    return (cleaned[:300] or "下载失败", False)
