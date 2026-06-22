import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { readClipboard, writeClipboard } from "@/lib/desktop";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * 带中文右键菜单的输入框（剪切/复制/粘贴/全选）。
 * 用自定义菜单替代系统菜单，保证中文，不受系统语言/打包环境影响。
 */
export function ContextMenuInput({
  value,
  onChange,
  placeholder,
  className,
  onKeyDown,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  // 右键打开菜单瞬间，输入框可能失焦导致选区丢失，故在此快照选区
  const savedSel = useRef<[number, number]>([0, 0]);

  const get = () => {
    const el = ref.current;
    if (!el) return null;
    const [s, e] = savedSel.current;
    return { el, s, e };
  };

  const hasSelection = () => {
    const r = get();
    return !!r && r.s !== r.e;
  };

  const copy = async () => {
    const r = get();
    if (!r || r.s === r.e) return;
    await writeClipboard(r.el.value.slice(r.s, r.e));
  };

  const cut = async () => {
    const r = get();
    if (!r || r.s === r.e) return;
    await writeClipboard(r.el.value.slice(r.s, r.e));
    onChange(r.el.value.slice(0, r.s) + r.el.value.slice(r.e));
    requestAnimationFrame(() => {
      r.el.focus();
      r.el.setSelectionRange(r.s, r.s);
    });
  };

  const paste = async () => {
    const text = await readClipboard();
    if (!text) return;
    const r = get();
    if (!r) return;
    const nv = r.el.value.slice(0, r.s) + text + r.el.value.slice(r.e);
    onChange(nv);
    const pos = r.s + text.length;
    requestAnimationFrame(() => {
      r.el.focus();
      r.el.setSelectionRange(pos, pos);
    });
  };

  const selectAll = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => {
            const el = e.currentTarget;
            savedSel.current = [el.selectionStart ?? 0, el.selectionEnd ?? 0];
          }}
          placeholder={placeholder}
          className={className}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={cut} disabled={!hasSelection()}>
          剪切
        </ContextMenuItem>
        <ContextMenuItem onClick={copy} disabled={!hasSelection()}>
          复制
        </ContextMenuItem>
        <ContextMenuItem onClick={paste}>粘贴</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={selectAll}>全选</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
