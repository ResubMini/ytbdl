/**
 * 桌面原生能力封装（文件夹选择 / 在文件夹中显示 / 打开文件）。
 * 仅在 Tauri 运行时可用；浏览器开发模式下优雅降级。
 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple: false });
  return typeof res === "string" ? res : null;
}

export async function pickCookieFile(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({
    multiple: false,
    filters: [{ name: "cookies.txt", extensions: ["txt"] }],
  });
  return typeof res === "string" ? res : null;
}

export async function revealInFolder(path: string): Promise<void> {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export async function openFile(path: string): Promise<void> {
  if (!isTauri) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

/** 读剪贴板文本：Tauri 插件优先（不触发系统授权弹窗），否则回退浏览器 API。 */
export async function readClipboard(): Promise<string> {
  if (isTauri) {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return (await readText()) ?? "";
    } catch {
      return "";
    }
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

/** 写剪贴板文本。 */
export async function writeClipboard(text: string): Promise<void> {
  if (isTauri) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}
