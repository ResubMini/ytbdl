import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Loader2,
  Moon,
  Search,
  Settings,
  Sun,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenuInput } from "@/components/ContextMenuInput";
import { Separator } from "@/components/ui/separator";
import { api, type AppConfig, type EngineInfo, type MediaInfo } from "@/lib/api";
import { initJobs, useJobs } from "@/store";
import { MediaPreview } from "@/components/MediaPreview";
import { JobList } from "@/components/JobList";
import { SettingsDialog } from "@/components/SettingsDialog";

export default function App() {
  const [url, setUrl] = useState("");
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [format, setFormat] = useState("bv*+ba/b");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extractAudio, setExtractAudio] = useState(false);
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [audioLang, setAudioLang] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(
    () =>
      (localStorage.getItem("theme") as "light" | "dark") ??
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"),
  );

  // 主题
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  // WS 订阅 + 引擎信息 + 配置
  useEffect(() => {
    const cleanup = initJobs();
    api.health().then(setEngine).catch(() => {});
    api
      .getConfig()
      .then((c) => {
        setConfig(c);
        setFormat(c.default_format);
        setExtractAudio(c.extract_audio);
        setAudioFormat(c.audio_format);
      })
      .catch(() => {});
    return cleanup;
  }, []);

  async function handleAnalyze() {
    if (!url.trim()) return;
    setExtracting(true);
    setError(null);
    setMedia(null);
    try {
      const info = await api.extract(url.trim());
      setMedia(info);
      setFormat(config?.default_format ?? "bv*+ba/b");
      setAudioLang("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  async function handleDownload() {
    if (!media) return;
    setDownloading(true);
    setError(null);
    try {
      await api.download({
        url: media.url,
        format: extractAudio ? "ba" : format,
        extract_audio: extractAudio,
        audio_format: extractAudio ? audioFormat : undefined,
        language: audioLang || undefined,
      });
      // 任务会通过 WebSocket 出现在列表里
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  async function handleSaveSettings(patch: Partial<AppConfig>) {
    const updated = await api.putConfig(patch);
    setConfig(updated);
    if (patch.default_format) setFormat(patch.default_format);
    if (patch.extract_audio !== undefined) setExtractAudio(patch.extract_audio);
    if (patch.audio_format) setAudioFormat(patch.audio_format);
  }

  const canAnalyze = useMemo(
    () => url.trim().length > 0 && !extracting,
    [url, extracting],
  );

  // 检测到需要登录的下载错误 → 引导去设置 cookie
  const needsLogin = useJobs((s) =>
    Object.values(s.jobs).some(
      (j) =>
        j.status === "error" &&
        /sign in to confirm|not a bot|cookie|登录|验证|bot/i.test(j.error ?? ""),
    ),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <div className="flex items-center gap-2 font-semibold">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Video className="size-4" />
            </div>
            mp4WEB
          </div>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {engine ? (
              <>
                <span className="size-2 rounded-full bg-emerald-500" />
                版本：{engine.version}
              </>
            ) : (
              <span className="size-2 rounded-full bg-amber-500" />
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              title="设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* URL 输入 */}
        <div className="flex gap-2">
          <ContextMenuInput
            value={url}
            onChange={setUrl}
            onKeyDown={(e) => e.key === "Enter" && canAnalyze && handleAnalyze()}
            placeholder="粘贴视频链接（YouTube / B站 / 等 1000+ 站点）"
            className="h-11 flex-1 text-base"
          />
          <Button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="h-11 px-5 text-base"
          >
            {extracting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            解析
          </Button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* 预览 */}
        <div className="mt-5">
          {extracting ? (
            <PreviewSkeleton />
          ) : media ? (
            <MediaPreview
              media={media}
              format={format}
              onFormatChange={setFormat}
              onDownload={handleDownload}
              downloading={downloading}
              extractAudio={extractAudio}
              onExtractAudioChange={setExtractAudio}
              audioFormat={audioFormat}
              onAudioFormatChange={setAudioFormat}
              audioLang={audioLang}
              onAudioLangChange={setAudioLang}
            />
          ) : (
            <EmptyHint />
          )}
        </div>

        {/* 任务列表 */}
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <Download className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">下载任务</h2>
          </div>
          {needsLogin && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm">
              <span className="flex-1 text-amber-700 dark:text-amber-400">
                部分下载需要登录才能继续（如 YouTube）。一键借用浏览器登录信息即可。
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSettingsOpen(true)}
              >
                去设置
              </Button>
            </div>
          )}
          <JobList />
        </section>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config}
        onSave={handleSaveSettings}
      />
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex gap-4 rounded-xl border p-4">
      <div className="size-28 shrink-0 animate-pulse rounded-lg bg-muted" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-9 w-48 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-14 text-center text-muted-foreground">
      <Video className="mb-3 size-8 opacity-40" />
      <p className="text-sm">粘贴链接并点「解析」预览画质</p>
      <p className="mt-1 text-xs opacity-70">
        支持 YouTube、Bilibili 等 1000+ 站点
      </p>
    </div>
  );
}
