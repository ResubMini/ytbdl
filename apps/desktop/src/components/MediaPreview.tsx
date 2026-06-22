import { useMemo } from "react";
import { Download, Loader2, ListVideo, Music2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormatInfo, MediaInfo } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/utils";

interface Props {
  media: MediaInfo;
  format: string;
  onFormatChange: (v: string) => void;
  onDownload: () => void;
  downloading: boolean;
  extractAudio: boolean;
  onExtractAudioChange: (v: boolean) => void;
  audioFormat: string;
  onAudioFormatChange: (v: string) => void;
  audioLang: string;
  onAudioLangChange: (v: string) => void;
}

const AUDIO_FORMATS = ["mp3", "m4a", "flac", "opus", "wav"];

const LANG_NAMES: Record<string, string> = {
  en: "英语", ja: "日语", es: "西班牙语", "es-419": "拉美西语", fr: "法语",
  de: "德语", it: "意大利语", pt: "葡萄牙语", "pt-BR": "巴西葡语", ru: "俄语",
  ko: "韩语", zh: "中文", "zh-Hans": "简中", "zh-Hant": "繁中", "zh-CN": "简中",
  "zh-TW": "繁中", ar: "阿拉伯语", hi: "印地语", tr: "土耳其语", id: "印尼语",
  th: "泰语", vi: "越南语", nl: "荷兰语", pl: "波兰语", sv: "瑞典语", uk: "乌克兰语",
};

function langName(code: string): string {
  return LANG_NAMES[code] ?? LANG_NAMES[code.split("-")[0]] ?? code;
}

function heightOf(f: FormatInfo): number {
  const res = f.resolution ?? "";
  const m = res.match(/(\d{3,4})p?$/);
  return m ? Number(m[1]) : f.tbr ?? f.vbr ?? 0;
}

export function MediaPreview({
  media,
  format,
  onFormatChange,
  onDownload,
  downloading,
  extractAudio,
  onExtractAudioChange,
  audioFormat,
  onAudioFormatChange,
  audioLang,
  onAudioLangChange,
}: Props) {
  const videoFormats = useMemo(() => {
    const list = (media.formats ?? []).filter(
      (f) => f.vcodec && f.vcodec !== "none" && f.resolution,
    );
    return list.sort((a, b) => heightOf(b) - heightOf(a)).slice(0, 15);
  }, [media]);

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {/* 缩略图 */}
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:w-52">
          {media.thumbnail ? (
            <img
              src={media.thumbnail}
              alt={media.title ?? ""}
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : null}
          {media.duration ? (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
              {formatDuration(media.duration)}
            </span>
          ) : null}
        </div>

        {/* 信息 + 操作 */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="space-y-1.5">
            <h3 className="line-clamp-2 font-medium leading-snug">
              {media.title ?? media.url}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {media.uploader && <span>{media.uploader}</span>}
              {media.is_playlist && (
                <Badge variant="secondary" className="gap-1">
                  <ListVideo className="size-3" />
                  播放列表 · {media.playlist_count ?? media.entries?.length ?? 0} 项
                </Badge>
              )}
              {media.is_live && <Badge variant="destructive">直播中</Badge>}
            </div>
          </div>

          <div className="mt-auto space-y-3">
            {/* 音频提取开关 */}
            <div className="flex items-center gap-2">
              <Switch
                id="audio-only"
                checked={extractAudio}
                onCheckedChange={onExtractAudioChange}
              />
              <Label htmlFor="audio-only" className="cursor-pointer text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Music2 className="size-3.5" /> 仅提取音频
                </span>
              </Label>
            </div>

            {/* 多音轨：选择语言 */}
            {(media.audio_languages?.length ?? 0) > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">音轨</span>
                <Select
                  value={audioLang || "__auto__"}
                  onValueChange={(v) => onAudioLangChange(v === "__auto__" ? "" : v)}
                >
                  <SelectTrigger className="h-9 w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">默认（自动）</SelectItem>
                    {media.audio_languages!.map((l) => (
                      <SelectItem key={l} value={l}>
                        {langName(l)} · {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {extractAudio ? (
                <Select value={audioFormat} onValueChange={onAudioFormatChange}>
                  <SelectTrigger className="h-10 w-[210px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIO_FORMATS.map((f) => (
                      <SelectItem key={f} value={f}>
                        音频 · {f.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={format} onValueChange={onFormatChange}>
                  <SelectTrigger className="h-10 w-[210px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>预设</SelectLabel>
                      <SelectItem value="bv*+ba/b">自动最佳画质</SelectItem>
                      <SelectItem value="ba">
                        <span className="inline-flex items-center gap-2">
                          <Music2 className="size-3.5" /> 仅音频
                        </span>
                      </SelectItem>
                    </SelectGroup>
                    {videoFormats.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>指定画质</SelectLabel>
                        {videoFormats.map((f) => (
                          <SelectItem key={f.format_id} value={f.format_id!}>
                            {f.resolution} · {f.ext}
                            {f.fps ? ` @${Math.round(f.fps)}` : ""}
                            {f.filesize || f.filesize_approx
                              ? ` · ${formatBytes(f.filesize ?? f.filesize_approx)}`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              )}

              <Button onClick={onDownload} disabled={downloading} className="h-10">
                {downloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                下载
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
