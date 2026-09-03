"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvidenceDto } from "@/core/visibility";

/**
 * 证据的缩略图和放大层。
 *
 * 投票要靠证据判断，而一张 128 高的缩略图根本看不清「他到底做没做成」。
 * 所以图片和视频点开进全屏，音频不需要 - 声音没有大小之分，
 * 原地那个播放条已经够用。
 *
 * 全屏层自己管三件事：Esc 关、点背景关、打开时锁住背后的滚动。
 * 少一件都会变成「关不掉」或者「背后跟着一起滚」。
 */

function isZoomable(kind: EvidenceDto["kind"]): boolean {
  return kind === "image" || kind === "video";
}

export function EvidenceThumb({ item, label, onOpen }: { item: EvidenceDto; label: string; onOpen: (item: EvidenceDto) => void }) {
  if (item.kind === "audio") {
    return <audio controls src={item.url} className="w-56 shrink-0" aria-label={label} />;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`放大看${label}`}
      className="relative shrink-0 overflow-hidden rounded-xl border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-mark"
    >
      {item.kind === "image" ? (
        <img src={item.url} alt={label} className="h-32 w-44 object-cover" />
      ) : (
        // 缩略图上不给 controls：这里点一下是「放大」，播放留到全屏层里
        <video src={item.url} muted playsInline preload="metadata" className="h-32 w-56 bg-redact object-cover" />
      )}
      <span
        aria-hidden="true"
        className="absolute bottom-1 right-1 rounded-full bg-ground/85 px-2 py-0.5 text-[11px] font-bold text-mark"
      >
        {item.kind === "video" ? "播放" : "放大"}
      </span>
    </button>
  );
}

export function EvidenceLightbox({ item, onClose }: { item: EvidenceDto | null; onClose: () => void }) {
  const open = item !== null && isZoomable(item.kind);

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKey);
    // 全屏层开着的时候锁住背后的滚动，否则手指一划背景跟着跑
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previous;
    };
  }, [open, handleKey]);

  if (!open || !item) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="放大看证据"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/95 p-4"
    >
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onClose(); }}
        aria-label="关掉"
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-11 w-11 items-center justify-center rounded-full border border-line text-[20px] text-bright"
      >
        ×
      </button>

      {/* 点内容本身不该关掉，只有点背景才关 */}
      <div onClick={(event) => event.stopPropagation()} className="max-h-full max-w-full">
        {item.kind === "image" ? (
          <img src={item.url} alt="放大的证据" className="max-h-[88dvh] max-w-full object-contain" />
        ) : (
          <video
            src={item.url}
            controls
            autoPlay
            playsInline
            className="max-h-[88dvh] max-w-full bg-redact object-contain"
          />
        )}
      </div>
    </div>
  );
}

/** 想用放大层的页面调这个拿状态，省得每个页面各写一遍 */
export function useEvidenceViewer() {
  const [zoomed, setZoomed] = useState<EvidenceDto | null>(null);
  return {
    zoomed,
    open: (item: EvidenceDto) => setZoomed(item),
    close: () => setZoomed(null),
  };
}
