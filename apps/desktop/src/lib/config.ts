/**
 * sidecar 端点配置。
 *
 * 生产：Tauri Rust 外壳启动 sidecar 时，把 {baseUrl, token} 注入 window.__SIDECAR__。
 * 开发：window.__SIDECAR__ 不存在时，用 dev 默认值（指向手动启动的 sidecar）。
 */
declare global {
  interface Window {
    __SIDECAR__?: {
      baseUrl: string;
      token: string;
    };
  }
}

const DEV_DEFAULTS = {
  baseUrl: "http://127.0.0.1:8765",
  token: "dev-token-change-me",
};

export const sidecar: { baseUrl: string; token: string } =
  typeof window !== "undefined" && window.__SIDECAR__
    ? window.__SIDECAR__
    : DEV_DEFAULTS;
