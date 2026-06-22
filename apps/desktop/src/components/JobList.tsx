import { useMemo } from "react";
import {
  CheckCircle2,
  FileVideo,
  FolderOpen,
  Loader2,
  RotateCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { api, type Job } from "@/lib/api";
import { useJobs } from "@/store";
import { revealInFolder } from "@/lib/desktop";
import { formatBytes, formatDuration, formatSpeed } from "@/lib/utils";

const ACTIVE = new Set<Job["status"]>(["queued", "downloading", "postprocessing"]);

function pct(job: Job): number {
  const d = job.progress.downloaded_bytes ?? 0;
  const total = job.progress.total_bytes ?? job.progress.total_bytes_estimate ?? 0;
  return total > 0 ? Math.min(100, (d / total) * 100) : 0;
}

function StatusIcon({ status }: { status: Job["status"] }) {
  switch (status) {
    case "finished":
      return <CheckCircle2 className="size-4 text-emerald-500" />;
    case "error":
      return <XCircle className="size-4 text-destructive" />;
    case "queued":
      return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
    case "postprocessing":
      return <Loader2 className="size-4 animate-spin text-violet-500" />;
    default:
      return <Loader2 className="size-4 animate-spin text-blue-500" />;
  }
}

function statusLabel(status: Job["status"]): string {
  return {
    queued: "排队中",
    downloading: "下载中",
    postprocessing: "处理中",
    finished: "已完成",
    error: "失败",
    cancelled: "已取消",
  }[status];
}

export function JobList() {
  const jobs = useJobs((s) => s.jobs);
  const { active, done } = useMemo(() => {
    const all = Object.values(jobs).sort((a, b) => b.created_at - a.created_at);
    return {
      active: all.filter((j) => ACTIVE.has(j.status)),
      done: all.filter((j) => !ACTIVE.has(j.status)),
    };
  }, [jobs]);

  if (active.length === 0 && done.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
        暂无下载任务
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {active.map((job) => (
        <JobItem key={job.id} job={job} />
      ))}
      {done.length > 0 && (
        <>
          <div className="flex items-center gap-3 px-1 pt-4 pb-1">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">
              已完成 · {done.length}
            </span>
            <Separator className="flex-1" />
          </div>
          {done.map((job) => (
            <JobItem key={job.id} job={job} />
          ))}
        </>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function JobItem({ job }: { job: Job }) {
  const active = ACTIVE.has(job.status);
  const progress = pct(job);
  const title = job.title || job.url;
  const canRetry = job.status === "error" || job.status === "cancelled";

  return (
    <div className="rounded-xl border bg-card p-3.5 text-card-foreground transition-colors hover:bg-accent/30">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <StatusIcon status={job.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{title}</p>
            <span
              className={
                "ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs " +
                (job.status === "finished"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : job.status === "error"
                    ? "bg-destructive/10 text-destructive"
                    : job.status === "cancelled"
                      ? "bg-muted text-muted-foreground"
                      : "bg-blue-500/10 text-blue-600 dark:text-blue-400")
              }
            >
              {statusLabel(job.status)}
            </span>
          </div>

          {active && job.status === "downloading" && (
            <>
              <Progress value={progress} className="mt-2 h-1.5" />
              <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                <span>{progress.toFixed(0)}%</span>
                <span>{formatBytes(job.progress.downloaded_bytes)}</span>
                {job.progress.speed != null && (
                  <span>{formatSpeed(job.progress.speed)}</span>
                )}
                {job.progress.eta != null && job.progress.eta > 0 && (
                  <span>剩余 {formatDuration(job.progress.eta)}</span>
                )}
              </div>
            </>
          )}

          {job.status === "finished" && job.filename && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileVideo className="size-3.5 shrink-0" />
              <span className="truncate">{job.filename}</span>
            </div>
          )}

          {job.status === "error" && job.error && (
            <p className="mt-1 text-xs text-destructive">{job.error}</p>
          )}
        </div>

        {/* 操作 */}
        <div className="flex shrink-0 items-center gap-0.5">
          {active && (
            <ActionButton title="取消" onClick={() => api.cancelJob(job.id)}>
              <X className="size-4" />
            </ActionButton>
          )}
          {canRetry && (
            <ActionButton title="重试" onClick={() => api.retryJob(job.id)}>
              <RotateCw className="size-4" />
            </ActionButton>
          )}
          {job.status === "finished" && job.filename && (
            <ActionButton
              title="在文件夹中显示"
              onClick={() => job.filename && revealInFolder(job.filename)}
            >
              <FolderOpen className="size-4" />
            </ActionButton>
          )}
          {!active && (
            <ActionButton title="删除记录" onClick={() => api.removeJob(job.id)}>
              <Trash2 className="size-4 hover:text-destructive" />
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}
