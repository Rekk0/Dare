"use client";

import { useEffect, useState } from "react";
import Redacted from "@/components/Redacted";
import type { MyAssignmentDto } from "@/core/visibility";

export interface TaskCardProps {
  assignment: MyAssignmentDto;
  endAt: Date;
  onUpload?: () => void;
  onGuess?: () => void;
}

function formatRemaining(endAt: Date, now: number): string {
  const seconds = Math.max(0, Math.ceil((endAt.getTime() - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}

export default function TaskCard({ assignment, endAt, onUpload, onGuess }: TaskCardProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (assignment.taskContent === null) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5" aria-label="你的任务">
        <p className="mb-4 text-[15px] text-dim">任务尚未分配</p>
        <div className="h-4 w-full rounded-sm bg-redact" aria-hidden="true" />
      </section>
    );
  }

  return (
    <section
      className={`relative rounded-2xl border border-line bg-surface p-5 ${assignment.busted ? "border-l-4 border-l-alarm" : ""}`}
      aria-label="你的任务"
    >
      {assignment.busted ? (
        <span className="absolute right-5 top-5 rounded-full bg-alarm px-3 py-1 text-[11px] font-bold text-ground">
          已暴露
        </span>
      ) : null}

      <div className={assignment.busted ? "opacity-40" : undefined}>
        <p className="mb-3 text-[11px] tracking-[0.2em] text-dim">你的任务</p>
        <Redacted text={assignment.taskContent} />
      </div>

      <div className="mt-10 flex items-center justify-between gap-3">
        <span className="text-[15px] font-bold tabular-nums text-mark">
          {formatRemaining(endAt, now)}
        </span>
        <span className="text-[12px] text-dim">剩余时间</span>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        <button type="button" onClick={onUpload} className="min-h-12 rounded-full bg-mark px-5 text-[15px] font-bold text-ground">
          {assignment.busted ? "为面子继续上传" : "上传证据"}
        </button>
        <button type="button" onClick={onGuess} className="min-h-12 rounded-full border border-line px-5 text-[15px] font-bold text-bright">
          去猜别人的任务
        </button>
      </div>
    </section>
  );
}
