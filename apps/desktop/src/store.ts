import { create } from "zustand";
import { api, connectEvents, type Job, type JobProgress, type JobStatus, type SidecarEvent } from "./lib/api";

interface JobsState {
  jobs: Record<string, Job>;
  connected: boolean;
  /** 应用一个 sidecar 事件 */
  applyEvent: (ev: SidecarEvent) => void;
  /** 批量载入（初次拉取历史） */
  setJobs: (jobs: Job[]) => void;
  setConnected: (v: boolean) => void;
}

export const useJobs = create<JobsState>((set) => ({
  jobs: {},
  connected: false,
  applyEvent: (ev) =>
    set((state) => {
      const next = { ...state.jobs };
      const id = (ev as { job_id?: string }).job_id;
      if (!id) return state;

      // 删除：直接从 map 移除
      if (ev.type === "job.removed") {
        if (!next[id]) return state;
        delete next[id];
        return { jobs: next };
      }

      const cur: Job = next[id] ?? {
        id,
        url: "",
        status: "queued",
        created_at: Date.now() / 1000,
        progress: {},
      };

      switch (ev.type) {
        case "job.created": {
          next[id] = {
            ...cur,
            status: (ev.status as JobStatus) ?? "queued",
            url: ev.url ?? cur.url,
            title: ev.title ?? cur.title,
          };
          break;
        }
        case "job.status":
          next[id] = { ...cur, status: ev.status };
          break;
        case "job.progress": {
          const prog: JobProgress = {
            downloaded_bytes: ev.downloaded_bytes,
            total_bytes: ev.total_bytes,
            total_bytes_estimate: ev.total_bytes_estimate,
            speed: ev.speed,
            eta: ev.eta,
            elapsed: ev.elapsed,
            fragment_index: ev.fragment_index,
            fragment_count: ev.fragment_count,
          };
          next[id] = {
            ...cur,
            status: ev.status === "finished" ? cur.status : "downloading",
            progress: prog,
          };
          break;
        }
        case "job.postprocess":
          next[id] = { ...cur, status: "postprocessing" };
          break;
        case "job.finished":
          next[id] = {
            ...cur,
            status: "finished",
            filename: ev.filename ?? cur.filename,
            title: ev.title ?? cur.title,
          };
          break;
        case "job.error":
          next[id] = { ...cur, status: "error", error: ev.error };
          break;
        case "job.cancelled":
          next[id] = { ...cur, status: "cancelled" };
          break;
        default:
          return state;
      }
      return { jobs: next };
    }),
  setJobs: (jobs) =>
    set(() => ({
      jobs: Object.fromEntries(jobs.map((j) => [j.id, j])),
    })),
  setConnected: (v) => set({ connected: v }),
}));

/** 启动 WS 订阅 + 首次拉取历史任务。返回清理函数。 */
export function initJobs(): () => void {
  useJobs.getState().setConnected(true);
  // 拉取已有任务历史
  api
    .listJobs()
    .then((jobs) => useJobs.getState().setJobs(jobs))
    .catch(() => {});
  const disconnect = connectEvents((ev) => useJobs.getState().applyEvent(ev));
  return () => {
    useJobs.getState().setConnected(false);
    disconnect();
  };
}
