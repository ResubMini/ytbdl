"""token 鉴权。外壳拉起 sidecar 时注入随机 token，所有请求需携带。"""
from __future__ import annotations

from fastapi import Header, HTTPException, Query, status

from .config import TOKEN


def require_token_header(authorization: str | None = Header(default=None)) -> None:
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")


def require_token_query(token: str | None = Query(default=None)) -> None:
    """WebSocket 不能用 Header 鉴权，改用 query 参数 ?token=。"""
    if token != TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
