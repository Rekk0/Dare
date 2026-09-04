"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { copyText } from "@/lib/clipboard";

type Status = "recruiting" | "locked" | "assigned" | "running" | "voting" | "settled";

interface Activity {
  title: string;
  code: string;
  status: Status;
  taskDeadline: string;
  startAt: string;
  endAt: string;
  voteDeadline: string;
  eliminated: boolean;
}

interface Participant {
  pid: string;
  nickname: string;
  eliminatedAt: string | null;
}

/** 每个状态说一句人话，并指出下一个节点是哪个时间字段。settled 没有下一个节点 */
const STATES: Record<Status, { text: string; next?: keyof Activity }> = {
  recruiting: { text: "大家正在交题", next: "taskDeadline" },
  locked: { text: "题目锁定，正在分配", next: "startAt" },
  assigned: { text: "任务已发，等开场", next: "startAt" },
  running: { text: "暗任务进行中", next: "endAt" },
  voting: { text: "现在投票", next: "voteDeadline" },
  settled: { text: "这一局结了" },
};

/**
 * 入口按钮。不能点的**禁用但不隐藏**，并写清楚为什么 -
 * 藏起来的话用户根本不知道有这么个东西、什么时候能用。
 *
 * 定义在组件外面：详情页每秒刷一次倒计时，定义在里面的话每次渲染
 * 都是一个新的组件类型，五个按钮会跟着每秒重新挂载一遍。
 */
function Entry({ label, href, enabled, why, note }: { label: string; href: string; enabled: boolean; why: string; note?: string }) {
  return (
    <div>
      <a
        href={enabled ? href : undefined}
        aria-disabled={!enabled}
        className={`block min-h-12 rounded-full border border-line py-3 text-center font-bold ${
          enabled ? "text-bright" : "pointer-events-none text-dim opacity-55"
        }`}
      >
        {label}
      </a>
      {enabled
        ? note
          ? <p className="mt-1 text-center text-[12px] text-dim">{note}</p>
          : null
        : <p className="mt-1 text-center text-[12px] text-dim">{why}</p>}
    </div>
  );
}

export default function ActivityPage() {
  const { id } = useParams<{ id: string }>();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sharing, setSharing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState("");
  /** 我交过题没有。一人一题，交过之后这个入口是「改题」不是再出一道 */
  const [hasTask, setHasTask] = useState(false);

  useEffect(() => {
    fetch(`/api/activities/${id}`).then((r) => r.json()).then(setActivity).catch(() => undefined);
    fetch(`/api/activities/${id}/participants`)
      .then((r) => r.json())
      .then((data: { participants?: Participant[] }) => setParticipants(data.participants ?? []))
      .catch(() => undefined);
    fetch(`/api/activities/${id}/tasks`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { task: unknown } | null) => setHasTask(Boolean(data?.task)))
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!activity) {
    return <main className="mx-auto max-w-[420px] px-5 py-8 text-dim">正在接上这一局。</main>;
  }

  const state = STATES[activity.status];
  const nextAt = state.next ? new Date(activity[state.next] as string).getTime() : null;
  const seconds = nextAt === null ? null : Math.max(0, Math.ceil((nextAt - now) / 1000));
  const countdown =
    seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const out = activity.eliminated;
  // 复制成功要给回执。没有回执的话在 http 下点了没反应，
  // 用户分不清是没复制成功还是复制了但界面没说
  async function copy(what: "code" | "link", value: string) {
    const ok = await copyText(value);
    setCopied(ok ? what : "fail");
    window.setTimeout(() => setCopied(""), 1800);
  }
  const is = (...allowed: Status[]) => !out && allowed.includes(activity.status);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
      <a href="/" className="text-[13px] text-dim">&lt; 回首页</a>
      <p className="mt-6 text-[12px] tracking-[.3em] text-mark">这一局</p>
      <h1 className="mt-3 text-3xl font-bold text-bright">{activity.title}</h1>

      {out ? (
        <p className="mt-4 rounded-xl border border-alarm p-3 text-[14px] text-alarm">
          你没交题，这局没你了。
        </p>
      ) : (
        <>
          <p className="mt-4 text-[15px] text-body">
            {state.text}
            {countdown ? (
              <span className="text-dim">
                ，离下个节点 <span className="tabular-nums text-bright">{countdown}</span>
              </span>
            ) : null}
          </p>

          <button
            type="button"
            onClick={() => setSharing(!sharing)}
            className="mt-5 min-h-11 rounded-full border border-mark px-4 text-[14px] font-bold text-mark"
          >
            {sharing ? "收起邀请码" : "分享这一局"}
          </button>

          {sharing ? (
            <section className="mt-3 rounded-2xl border border-line bg-surface p-4">
              {/* 邀请码不用 display 字体。那份子集只收了 display 文案要的字，
                  26 个大写字母缺 20 个，用了会静默掉回系统字体 */}
              <button
                type="button"
                onClick={() => void copy("code", activity.code)}
                className="w-full select-all text-center text-4xl font-bold tracking-[.22em] tabular-nums text-mark"
              >
                {activity.code}
              </button>
              <p className="mt-2 text-center text-[12px] text-dim">
                {copied === "code" ? "复制好了" : copied === "fail" ? "复制不了，长按选中它" : "点一下复制邀请码"}
              </p>
              <button
                type="button"
                onClick={() => void copy("link", window.location.href)}
                className="mt-4 min-h-11 w-full rounded-full border border-line text-[14px] font-bold text-bright"
              >
                {copied === "link" ? "链接复制好了" : "复制邀请链接"}
              </button>
            </section>
          ) : null}
        </>
      )}

      <section className="mt-8 rounded-2xl border border-line bg-surface p-4">
        <p className="text-[13px] text-dim">这局有谁 · {participants.length} 人</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {participants.map((participant) => (
            <span key={participant.pid} className={`rounded-full border px-3 py-1 text-[13px] ${participant.eliminatedAt ? "border-alarm text-alarm line-through" : "border-line text-body"}`}>
              {participant.nickname}{participant.eliminatedAt ? " 已出局" : ""}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-4">
        <Entry
          label={hasTask ? "改题" : "出题"}
          href={`/a/${id}/task`}
          enabled={is("recruiting")}
          why={hasTask ? "题已经交了，截止后锁死" : "交题截止后就锁死了"}
          note={hasTask ? "已经交过一道，截止前还能改" : undefined}
        />
        <Entry label="我的任务卡" href={`/a/${id}/card`} enabled={is("assigned", "running", "voting", "settled")} why="等交题截止后分配" />
        <Entry label="猜别人的任务" href={`/a/${id}/guess`} enabled={is("running")} why="开场后才能猜" />
        <Entry label="投票" href={`/a/${id}/vote`} enabled={is("voting", "settled")} why="活动结束后开投票" />
        <Entry label="看结果" href={`/a/${id}/result`} enabled={is("settled")} why="投票结束后出结果" />
      </section>
    </main>
  );
}
