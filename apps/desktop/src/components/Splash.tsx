import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { api } from "@/lib/api";

/** 启动画面：窗口秒开后显示，轮询 sidecar 就绪，就绪后切到主界面。 */
export function Splash({ onReady }: { onReady: () => void }) {
  const [pct, setPct] = useState(8);
  const [status, setStatus] = useState("正在启动…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let elapsed = 0;
    const tick = 500;

    const poll = async () => {
      if (cancelled) return;
      try {
        await api.health();
        if (cancelled) return;
        setPct(100);
        setStatus("就绪");
        setTimeout(() => !cancelled && onReady(), 350);
        return;
      } catch {
        /* sidecar 还没起来，继续轮询 */
      }
      elapsed += tick / 1000;
      if (elapsed > 60) {
        if (!cancelled) {
          setFailed(true);
          setStatus("启动失败，请重开");
        }
        return;
      }
      if (!cancelled) {
        // 进度慢慢爬到 92%，给人「在干活」的感觉
        setPct(Math.min(92, 8 + elapsed * 4));
        setStatus(elapsed > 4 ? "正在连接服务…" : "正在启动…");
        setTimeout(poll, tick);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [onReady]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="flex flex-col items-center gap-5">
        <div
          className={`flex size-20 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-xl ${
            failed ? "" : "animate-[pulse_2s_ease-in-out_infinite]"
          }`}
        >
          <Video className="size-10" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">mp4WEB</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            跨平台视频下载器
          </p>
        </div>
      </div>

      <div className="mt-10 w-60 space-y-2">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${failed ? 100 : pct}%` }}
          />
        </div>
        <p
          className={`text-center text-xs ${
            failed ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {status}
        </p>
      </div>
    </div>
  );
}
