"use client";

import { useEffect, useRef, useState } from "react";

export interface ShareCardData {
  /** 我识破了谁，可能好几个 */
  busted: string[];
  /** 我这一局执行的任务正文。没领到任务时是 null */
  myTask: string | null;
  /** 我这道题算没算过 */
  taskPassed: boolean;
  totalShares: string;
  taskShares: string;
  bountyShares: string;
  activityTitle: string;
}

const W = 1080;
const H = 1350;
const GROUND = "#0e1220";
const SURFACE = "#161b2e";
const MARK = "#ffe94a";
const BRIGHT = "#eef1fa";
const BODY = "#aab3d0";
const DIM = "#6c7699";
const REDACT = "#05070e";
const GAIN = "#4ade80";

/** 中文没有词边界，按字断行就行 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function draw(canvas: HTMLCanvasElement, data: ShareCardData): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = W;
  canvas.height = H;

  const font = (size: number, weight = "700") =>
    `${weight} ${size}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);

  // 顶部那条记号笔黄，把 DARE 挖出来，跟落地页的标识是一套
  ctx.save();
  ctx.translate(80, 96);
  ctx.rotate((-1.2 * Math.PI) / 180);
  ctx.fillStyle = MARK;
  ctx.fillRect(0, 0, 300, 96);
  ctx.fillStyle = GROUND;
  ctx.font = font(64);
  ctx.textBaseline = "middle";
  ctx.fillText("DARE", 26, 50);
  ctx.restore();

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = DIM;
  ctx.font = font(30, "500");
  ctx.fillText(data.activityTitle, 80, 250);

  let y = 340;

  // 份额是这张图的主角
  ctx.fillStyle = DIM;
  ctx.font = font(30, "500");
  ctx.fillText("我这一局拿到", 80, y);
  y += 130;
  ctx.fillStyle = GAIN;
  ctx.font = font(150);
  ctx.fillText(data.totalShares, 80, y);
  const shareWidth = ctx.measureText(data.totalShares).width;
  ctx.fillStyle = DIM;
  ctx.font = font(40, "500");
  ctx.fillText("份", 80 + shareWidth + 20, y);
  y += 60;
  ctx.fillStyle = BODY;
  ctx.font = font(30, "500");
  ctx.fillText(`任务 ${data.taskShares}  /  猜中 ${data.bountyShares}`, 80, y);

  y += 100;

  // 识破了谁
  ctx.fillStyle = SURFACE;
  ctx.fillRect(80, y, W - 160, 190);
  ctx.fillStyle = DIM;
  ctx.font = font(28, "500");
  ctx.fillText("我识破了", 120, y + 62);
  ctx.font = font(46);
  if (data.busted.length) {
    ctx.fillStyle = MARK;
    ctx.fillText(data.busted.join("、").slice(0, 14), 120, y + 130);
  } else {
    ctx.fillStyle = DIM;
    ctx.fillText("一个都没抓到", 120, y + 130);
  }

  y += 230;

  // 我执行的任务
  ctx.fillStyle = SURFACE;
  ctx.fillRect(80, y, W - 160, 300);
  ctx.fillStyle = DIM;
  ctx.font = font(28, "500");
  ctx.fillText("我的任务", 120, y + 62);

  ctx.font = font(38, "500");
  if (data.myTask) {
    ctx.fillStyle = BRIGHT;
    const lines = wrap(ctx, data.myTask, W - 240).slice(0, 4);
    lines.forEach((line, i) => ctx.fillText(line, 120, y + 130 + i * 54));
    ctx.fillStyle = data.taskPassed ? GAIN : DIM;
    ctx.font = font(30);
    ctx.fillText(data.taskPassed ? "做成了" : "没算过", 120, y + 130 + lines.length * 54 + 22);
  } else {
    // 没领到任务的人也能分享，这里画成涂黑条而不是留白
    ctx.fillStyle = REDACT;
    ctx.fillRect(120, y + 110, W - 320, 34);
    ctx.fillRect(120, y + 160, W - 420, 34);
    ctx.fillStyle = DIM;
    ctx.font = font(30, "500");
    ctx.fillText("这一局没领到任务", 120, y + 240);
  }

  // 底部涂黑条收尾
  ctx.fillStyle = REDACT;
  ctx.fillRect(80, H - 150, 520, 26);
  ctx.fillRect(624, H - 150, 200, 26);
  ctx.fillStyle = DIM;
  ctx.font = font(26, "500");
  ctx.fillText("别让人看见。", 80, H - 80);
}

export default function ShareResultCard({ data, onClose }: { data: ShareCardData; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw(canvas, data);
    // toBlob 比 toDataURL 省内存，大图上差别很明显
    canvas.toBlob((blob) => {
      if (blob) setUrl(URL.createObjectURL(blob));
    }, "image/png");
  }, [data]);

  useEffect(() => {
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [url]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="分享我的战果"
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-ground/95 p-4"
    >
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      <div onClick={(event) => event.stopPropagation()} className="flex w-full max-w-[380px] flex-col items-center gap-4">
        {url ? (
          <img src={url} alt="我的战果" className="w-full rounded-2xl border border-line" />
        ) : (
          <p className="text-dim">正在画…</p>
        )}
        {/* 手机上 a download 基本不生效，长按存图才是那条真路 */}
        <p className="text-center text-[13px] text-dim">长按图片保存到相册</p>
        <button
          type="button"
          onClick={onClose}
          className="min-h-12 w-full rounded-full border border-line font-bold text-bright"
        >
          关掉
        </button>
      </div>
    </div>
  );
}
