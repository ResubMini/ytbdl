"""事件总线：把 yt-dlp 工作线程的进度/日志，广播到所有 WebSocket 订阅者。

关键点：yt-dlp 的 progress_hooks 在**工作线程**里同步调用，
而 FastAPI/uvicorn 是 asyncio。用 loop.call_soon_threadsafe 桥接。
"""
from __future__ import annotations

import asyncio
from typing import Any


class EventHub:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue[dict]:
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=512)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict]) -> None:
        self._subscribers.discard(q)

    def broadcast(self, event: dict[str, Any]) -> None:
        """线程安全广播。可从任意线程调用。"""
        if self._loop is None:
            return
        self._loop.call_soon_threadsafe(self._do_broadcast, event)

    def _do_broadcast(self, event: dict[str, Any]) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # 队列满：丢最旧的一条再塞，保证最新进度能送达
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    pass


hub = EventHub()
