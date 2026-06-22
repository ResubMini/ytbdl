import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { isTauri } from "@/lib/desktop";

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "downloading"; pct: number }
  | { kind: "error"; msg: string };

/** 软件更新：检查 → 下载安装 → 重启。 */
export function UpdateSection() {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (!isTauri) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion().then(setVersion))
      .catch(() => {});
  }, []);

  async function checkUpdate() {
    if (!isTauri) return;
    setState({ kind: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update?.available) {
        setState({
          kind: "available",
          version: update.version,
          notes: update.body ?? undefined,
        });
      } else {
        setState({ kind: "latest" });
      }
    } catch (e) {
      setState({ kind: "error", msg: errMsg(e) });
    }
  }

  async function doInstall() {
    if (!isTauri) return;
    setState({ kind: "downloading", pct: 0 });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (!update) return;
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = (event.data as { contentLength?: number }).contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += (event.data as { chunkLength?: number }).chunkLength ?? 0;
          setState({
            kind: "downloading",
            pct: total ? Math.round((downloaded / total) * 100) : 0,
          });
        }
      });
      await relaunch();
    } catch (e) {
      setState({ kind: "error", msg: errMsg(e) });
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>软件更新</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            当前版本 {version || "—"}
          </p>
        </div>
      </div>

      {state.kind === "idle" && (
        <Button variant="secondary" onClick={checkUpdate}>
          <RefreshCw className="size-4" />
          检查更新
        </Button>
      )}

      {state.kind === "checking" && (
        <Button variant="secondary" disabled>
          <Loader2 className="size-4 animate-spin" />
          检查中…
        </Button>
      )}

      {state.kind === "latest" && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" /> 已是最新版本
        </p>
      )}

      {state.kind === "available" && (
        <div className="space-y-2">
          <p className="text-sm">
            发现新版本 <span className="font-medium">{state.version}</span>
          </p>
          {state.notes && (
            <p className="text-xs text-muted-foreground whitespace-pre-line">
              {state.notes}
            </p>
          )}
          <Button onClick={doInstall}>
            <Download className="size-4" />
            立即更新
          </Button>
        </div>
      )}

      {state.kind === "downloading" && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            下载更新中… {state.pct}%
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${state.pct}%` }}
            />
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-destructive">{state.msg}</p>
      )}
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
