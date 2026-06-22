import { sidecar } from "./config";

/** ────── 协议类型（与后端 schemas.py 对齐）────── */
export interface FormatInfo {
  format_id?: string;
  ext?: string;
  resolution?: string;
  vcodec?: string;
  acodec?: string;
  fps?: number;
  vbr?: number;
  abr?: number;
  tbr?: number;
  filesize?: number;
  filesize_approx?: number;
  language?: string;
}

export interface MediaInfo {
  id?: string;
  title?: string;
  url: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
  ext?: string;
  is_live?: boolean;
  is_playlist?: boolean;
  playlist_count?: number;
  formats?: FormatInfo[];
  audio_languages?: string[];
  entries?: MediaInfo[];
}

export interface JobProgress {
  downloaded_bytes?: number | null;
  total_bytes?: number | null;
  total_bytes_estimate?: number | null;
  speed?: number | null;
  eta?: number | null;
  elapsed?: number | null;
  fragment_index?: number | null;
  fragment_count?: number | null;
}

export type JobStatus =
  | "queued"
  | "downloading"
  | "postprocessing"
  | "finished"
  | "error"
  | "cancelled";

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  title?: string | null;
  filename?: string | null;
  error?: string | null;
  created_at: number;
  progress: JobProgress;
}

export interface EngineInfo {
  ok: boolean;
  name: string;
  version: string;
  channel: string;
  sidecar_version: string;
}

export interface AppConfig {
  download_dir: string;
  max_concurrent: number;
  default_format: string;
  extract_audio: boolean;
  audio_format: string;
  cookie_source: "none" | "browser" | "file";
  cookie_browser: string;
  cookie_profile: string;
  cookie_file: string;
  cookie_imported_at: number;
  cookie_imported_count: number;
}

export interface BrowserInfo {
  id: string;
  name: string;
  unreliable: boolean;
}

export interface ProfileInfo {
  folder: string;
  name: string;
  email: string;
}

/** ────── REST ────── */
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${sidecar.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${sidecar.token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      detail = data?.detail ? String(data.detail) : JSON.stringify(data);
    } catch {
      const text = await res.text().catch(() => "");
      if (text) detail = text;
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => http<EngineInfo>("/v1/health"),
  extract: (url: string) =>
    http<MediaInfo>(`/v1/extract?url=${encodeURIComponent(url)}`),
  download: (body: {
    url: string;
    format?: string;
    outtmpl?: string;
    extract_audio?: boolean;
    audio_format?: string;
    language?: string;
  }) =>
    http<{ job_id: string }>("/v1/download", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listJobs: () => http<Job[]>("/v1/jobs"),
  cancelJob: (id: string) =>
    http<{ cancelled: boolean }>(`/v1/jobs/${id}`, { method: "DELETE" }),
  retryJob: (id: string) =>
    http<{ job_id: string }>(`/v1/jobs/${id}/retry`, { method: "POST" }),
  removeJob: (id: string) =>
    http<{ removed: boolean }>(`/v1/jobs/${id}/remove`, { method: "POST" }),
  getConfig: () => http<AppConfig>("/v1/config"),
  putConfig: (body: Partial<AppConfig>) =>
    http<AppConfig>("/v1/config", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getBrowsers: () =>
    http<{ browsers: BrowserInfo[] }>("/v1/cookies/browsers"),
  getProfiles: (browser: string) =>
    http<{ profiles: ProfileInfo[] }>(
      `/v1/cookies/profiles?browser=${encodeURIComponent(browser)}`,
    ),
  importCookies: (browser: string, profile: string) =>
    http<{
      ok: boolean;
      error: string | null;
      count: number;
      youtube_count: number;
      config: AppConfig;
    }>("/v1/cookies/import", {
      method: "POST",
      body: JSON.stringify({ browser, profile }),
    }),
};

/** ────── WebSocket ────── */
export type SidecarEvent =
  | { type: "job.created"; job_id: string } & Partial<Job>
  | { type: "job.status"; job_id: string; status: JobStatus }
  | { type: "job.progress"; job_id: string; status: JobStatus } & JobProgress
  | {
      type: "job.finished";
      job_id: string;
      filename?: string;
      title?: string;
      status: JobStatus;
    }
  | { type: "job.error"; job_id: string; error: string }
  | { type: "job.cancelled"; job_id: string }
  | { type: "job.removed"; job_id: string }
  | {
      type: "job.postprocess";
      job_id: string;
      status: string;
      postprocessor?: string;
    }
  | { type: "engine.updated"; version: string };

export function connectEvents(onEvent: (ev: SidecarEvent) => void): () => void {
  let closedByUs = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;

  const open = () => {
    const url = `${sidecar.baseUrl.replace(/^http/, "ws")}/v1/events?token=${encodeURIComponent(
      sidecar.token,
    )}`;
    ws = new WebSocket(url);
    ws.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data) as SidecarEvent);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (!closedByUs) {
        // 自动重连
        reconnectTimer = setTimeout(open, 2000);
      }
    };
    ws.onerror = () => ws?.close();
  };
  open();

  return () => {
    closedByUs = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}
