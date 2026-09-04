"use client";

import { useEffect, useState } from "react";

type Status = "recruiting" | "locked" | "assigned" | "running" | "voting" | "settled";

interface Row {
  id: string;
  title: string;
  code: string;
  status: Status;
  taskDeadline: string;
  startAt: string;
  endAt: string;
  voteDeadline: string;
  eliminated: boolean;
}

/** 每个状态一句人话，外加下一个节点看哪个时间字段 */
const STATES: Record<Status, { label: string; next?: keyof Row }> = {
  recruiting: { label: "还在交题", next: "taskDeadline" },
  locked: { label: "正在分配", next: "startAt" },
  assigned: { label: "等开场", next: "startAt" },
  running: { label: "进行中", next: "endAt" },
  voting: { label: "投票中", next: "voteDeadline" },
  settled: { label: "已结束" },
};

function when(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MyActivitiesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/me/activities")
      .then((r) => r.json())
      .then((d: { activities: Row[] }) => setRows(d.activities))
      .catch(() => setRows([]));
  }, []);

  // 没结束的排前面，结束的沉到后面
  const live = rows?.filter((r) => r.status !== "settled") ?? [];
  const done = rows?.filter((r) => r.status === "settled") ?? [];

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
      <a href="/" className="text-[13px] text-dim">&lt; 回首页</a>
      <h1 className="mt-6 text-3xl font-bold text-bright">我的活动</h1>

      {rows === null ? (
        <p className="mt-8 text-dim">正在寻找你的活动。</p>
      ) : rows.length === 0 ? (
        <div className="mt-8">
          <p className="text-[15px] leading-7 text-body">你还没加入任何活动。</p>
          <div className="mt-6 grid gap-3">
            <a href="/new" className="flex min-h-12 items-center justify-center rounded-full bg-mark font-bold text-ground">攒一局</a>
            <a href="/join" className="flex min-h-12 items-center justify-center rounded-full border border-line font-bold text-bright">输入邀请码</a>
          </div>
        </div>
      ) : (
        <div className="mt-8 grid gap-3">
          {live.map((row) => <Card key={row.id} row={row} />)}
          {done.length ? (
            <>
              <p className="mt-4 text-[12px] tracking-[.2em] text-dim">已经结束</p>
              {done.map((row) => <Card key={row.id} row={row} />)}
            </>
          ) : null}
        </div>
      )}
    </main>
  );
}

function Card({ row }: { row: Row }) {
  const state = STATES[row.status];
  const nextAt = state.next ? (row[state.next] as string) : null;

  return (
    <a
      href={`/a/${row.id}`}
      className="block rounded-2xl border border-line bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-[17px] font-bold text-bright">{row.title}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
            row.status === "settled" ? "bg-raised text-dim" : "bg-mark text-ground"
          }`}
        >
          {state.label}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-dim">
        邀请码 <span className="tracking-[.16em] text-body">{row.code}</span>
        {nextAt ? <span className="text-dim"> · 下个节点 {when(nextAt)}</span> : null}
      </p>
      {row.eliminated ? (
        <p className="mt-2 text-[13px] text-alarm">你没交题，这局没你了</p>
      ) : null}
    </a>
  );
}
