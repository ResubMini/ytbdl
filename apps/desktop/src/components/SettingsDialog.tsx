import { useEffect, useState } from "react";
import { FileText, FolderOpen, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type AppConfig, type BrowserInfo, type ProfileInfo } from "@/lib/api";
import { pickCookieFile, pickFolder } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { UpdateSection } from "@/components/UpdateSection";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: AppConfig | null;
  onSave: (patch: Partial<AppConfig>) => Promise<void>;
}

const AUDIO_FORMATS = ["mp3", "m4a", "flac", "opus", "wav"];

export function SettingsDialog({ open, onOpenChange, config, onSave }: Props) {
  const [draft, setDraft] = useState<Partial<AppConfig>>({});
  const [saving, setSaving] = useState(false);
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const selBrowser = draft.cookie_browser ?? config?.cookie_browser ?? "";

  // 打开时用当前配置初始化草稿 + 探测浏览器
  useEffect(() => {
    if (open && config) setDraft({ ...config });
    if (open) {
      setImportMsg(null);
      api.getBrowsers().then((r) => setBrowsers(r.browsers)).catch(() => {});
    }
  }, [open, config]);

  // 选了浏览器后，拉取它的 profile 列表
  useEffect(() => {
    if (open && selBrowser) {
      api
        .getProfiles(selBrowser)
        .then((r) => setProfiles(r.profiles))
        .catch(() => setProfiles([]));
    } else {
      setProfiles([]);
    }
  }, [open, selBrowser]);

  if (!config) return null;

  const set = <K extends keyof AppConfig>(k: K, v: AppConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  async function handleSave() {
    setSaving(true);
    try {
      const patch: Partial<AppConfig> = {};
      (Object.keys(draft) as (keyof AppConfig)[]).forEach((k) => {
        if (draft[k] !== config?.[k]) {
          // @ts-expect-error 同构赋值
          patch[k] = draft[k];
        }
      });
      await onSave(patch);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function chooseFolder() {
    const dir = await pickFolder();
    if (dir) set("download_dir", dir);
  }

  async function chooseCookieFile() {
    const f = await pickCookieFile();
    if (f) set("cookie_file", f);
  }

  async function handleImport() {
    const browser = draft.cookie_browser ?? config?.cookie_browser ?? "";
    const profile = draft.cookie_profile ?? config?.cookie_profile ?? "";
    if (!browser) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const r = await api.importCookies(browser, profile);
      if (r.ok) {
        setImportMsg({
          ok: true,
          text: `✓ 成功导入 ${r.youtube_count} 条登录信息`,
        });
        // 后端已把 cookie_source 设为 browser 并存了元信息，同步到草稿
        setDraft((d) => ({ ...d, ...r.config }));
      } else {
        setImportMsg({
          ok: false,
          text: r.error || "导入失败",
        });
      }
    } catch (e) {
      setImportMsg({
        ok: false,
        text: e instanceof Error ? e.message : "导入失败",
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>下载偏好，自动保存到本地。</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <UpdateSection />

          {/* 下载目录 */}
          <div className="space-y-2">
            <Label>下载目录</Label>
            <div className="flex gap-2">
              <Input
                value={(draft.download_dir ?? config.download_dir)}
                onChange={(e) => set("download_dir", e.target.value)}
                className="flex-1 font-mono text-xs"
              />
              <Button variant="outline" size="icon" onClick={chooseFolder}>
                <FolderOpen className="size-4" />
              </Button>
            </div>
          </div>

          {/* 并发 */}
          <div className="space-y-2">
            <Label>最大并发下载数</Label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={8}
                value={draft.max_concurrent ?? config.max_concurrent}
                onChange={(e) => set("max_concurrent", Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer accent-primary"
              />
              <span className="w-6 text-center text-sm font-medium tabular-nums">
                {draft.max_concurrent ?? config.max_concurrent}
              </span>
            </div>
          </div>

          {/* 默认画质 */}
          <div className="space-y-2">
            <Label>默认画质</Label>
            <Select
              value={draft.default_format ?? config.default_format}
              onValueChange={(v) => set("default_format", v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bv*+ba/b">自动最佳画质</SelectItem>
                <SelectItem value="ba">仅音频</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 音频提取 */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="pr-3">
              <Label className="cursor-pointer">默认提取音频</Label>
              <p className="text-xs text-muted-foreground">
                开启后下载时默认转为音频文件
              </p>
            </div>
            <Switch
              checked={draft.extract_audio ?? config.extract_audio}
              onCheckedChange={(v) => set("extract_audio", v)}
            />
          </div>

          {(draft.extract_audio ?? config.extract_audio) && (
            <div className="space-y-2">
              <Label>音频格式</Label>
              <Select
                value={draft.audio_format ?? config.audio_format}
                onValueChange={(v) => set("audio_format", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIO_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 登录信息（一键导入快照）*/}
          <div className="space-y-3 border-t pt-4">
            <div>
              <Label>登录信息</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                某些网站（如 YouTube）需要登录才能下载。从已登录的浏览器一键导入即可。
              </p>
            </div>

            {browsers.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">浏览器</Label>
                    <Select
                      value={(draft.cookie_browser ?? config.cookie_browser) || undefined}
                      onValueChange={(v) => set("cookie_browser", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择浏览器" />
                      </SelectTrigger>
                      <SelectContent>
                        {browsers.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                            {b.unreliable ? "（可能不可用）" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">账户</Label>
                    <Select
                      value={(draft.cookie_profile ?? config.cookie_profile) || "auto"}
                      onValueChange={(v) =>
                        set("cookie_profile", v === "auto" ? "" : v)
                      }
                      disabled={profiles.length === 0}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">默认</SelectItem>
                        {profiles.map((p) => (
                          <SelectItem key={p.folder} value={p.folder}>
                            {p.name}
                            {p.email ? ` · ${p.email}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={handleImport}
                    disabled={
                      importing || !(draft.cookie_browser ?? config.cookie_browser)
                    }
                  >
                    {importing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <LogIn className="size-4" />
                    )}
                    {config.cookie_imported_at ? "重新导入" : "导入登录信息"}
                  </Button>
                  {importMsg && (
                    <span
                      className={cn(
                        "text-xs",
                        importMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
                      )}
                    >
                      {importMsg.text}
                    </span>
                  )}
                </div>

                {!importMsg && config.cookie_imported_at > 0 && (
                  <p className="text-xs text-muted-foreground">
                    ✓ 已导入 {config.cookie_imported_count} 条登录信息 ·{" "}
                    {new Date(config.cookie_imported_at * 1000).toLocaleString()}
                  </p>
                )}

                <p className="text-xs text-muted-foreground/70">
                  提示：导入后即使浏览器关闭也可用；若日后失效，重新导入即可。
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                未检测到支持的浏览器。可在下方高级选项使用 cookies.txt 文件。
              </p>
            )}

            {/* 高级：cookies.txt（重度用户）*/}
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                高级选项
              </summary>
              <div className="mt-2 space-y-2">
                <Label className="text-xs text-muted-foreground">
                  使用 cookies.txt 文件（Netscape 格式）
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={draft.cookie_file ?? config.cookie_file}
                    onChange={(e) => {
                      set("cookie_file", e.target.value);
                      if (e.target.value) set("cookie_source", "file");
                    }}
                    placeholder="选择 cookies.txt 文件"
                    className="flex-1 font-mono text-xs"
                  />
                  <Button variant="outline" size="icon" onClick={chooseCookieFile}>
                    <FileText className="size-4" />
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={() => set("cookie_source", "none")}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  停用登录信息
                </button>
              </div>
            </details>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
