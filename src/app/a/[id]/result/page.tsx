"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import ShareResultCard, { type ShareCardData } from "@/components/ShareResultCard";
import type { RevealAssignmentDto } from "@/core/visibility";

type Settlement = {
  taskShares: string | number;
  bountyShares: string | number;
  totalShares: string | number;
  busted: boolean;
} | null;
type Participant = { pid: string; nickname: string };

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<RevealAssignmentDto[]>([]);
  const [mine, setMine] = useState<Settlement>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [me, setMe] = useState("");
  const [title, setTitle] = useState("");
  const [shown, setShown] = useState(0);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/activities/${id}/reveal`).then((r) => r.json()),
      fetch(`/api/activities/${id}/settlement`).then((r) => r.json()),
      fetch(`/api/activities/${id}/participants`).then((r) => r.json()),
      fetch(`/api/activities/${id}`).then((r) => r.json()),
    ])
      .then(([reveal, settlement, roster, activity]: [
        { assignments: RevealAssignmentDto[] },
        Settlement,
        { me: string; participants: Participant[] },
        { title: string },
      ]) => {
        setItems(reveal.assignments);
        setMine(settlement);
        setMe(roster.me);
        setTitle(activity.title ?? "");
        setNames(Object.fromEntries(roster.participants.map((p) => [p.pid, p.nickname])));
      })
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (shown >= items.length) return;
    const timer = window.setTimeout(() => setShown((n) => n + 1), 450);
    return () => window.clearTimeout(timer);
  }, [shown, items.length]);

  const total = items.length;
  const voided = items.filter((item) => item.busted).length;
  const sent = total - voided;

  /** 分享图要的三件事：识破了谁、自己做的什么题、拿了多少 */
  const shareData: ShareCardData | null = useMemo(() => {
    if (!me) return null;
    const mineRow = items.find((item) => item.assigneePid === me);
    return {
      busted: items
        .filter((item) => item.bustedByPid === me)
        .map((item) => names[item.assigneePid] ?? "某人"),
      myTask: mineRow?.taskContent ?? null,
      // 被识破的那一份归零，不算做成
      taskPassed: Number(mine?.taskShares ?? 0) > 0,
      totalShares: String(mine?.totalShares ?? 0),
      taskShares: String(mine?.taskShares ?? 0),
      bountyShares: String(mine?.bountyShares ?? 0),
      activityTitle: title,
    };
  }, [items, names, me, mine, title]);

  return (
    <main className="mx-auto min-h-[100dvh] max-w-[420px] px-5 py-8">
      <div className="flex items-center justify-between gap-3">
        <a href={`/a/${id}`} className="text-[13px] text-dim">&lt; 回这一局</a>
        <button
          type="button"
          onClick={() => setSharing(true)}
          disabled={!shareData}
          className="min-h-9 rounded-full border border-mark px-3 text-[13px] font-bold text-mark disabled:opacity-40"
        >
          分享我的战果
        </button>
      </div>

      <p className="mt-6 text-[12px] tracking-[.3em] text-mark">结算</p>
      <h1 className="mt-3 text-3xl font-bold text-bright">这一局，到账。</h1>

      {/* 自己的份额放最上面：打开结果页第一眼要看的就是这个，
          压在一串任务卡后面等 450ms 一条地播完才出现，节奏是反的 */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <p className="text-[13px] text-dim">你的份额</p>
        <p className="mt-2 text-5xl font-display tabular-nums text-gain">{mine ? mine.totalShares : 0}</p>
        <p className="mt-4 text-[14px] text-body">
          任务 {mine?.taskShares ?? 0} / 猜中 {mine?.bountyShares ?? 0}
        </p>
      </section>

      <div className="mt-8 space-y-3">
        {items.slice(0, shown).map((item) => (
          <section key={item.assignmentId} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[13px] font-bold text-bright">
              {names[item.assigneePid] ?? "未揭晓"}
              {item.assigneePid === me ? <span className="ml-2 text-[12px] font-normal text-mark">你</span> : null}
            </p>
            <p className="mt-2 text-[16px] leading-7 text-bright">{item.taskContent ?? "任务正文仍在保密"}</p>
            <p className="mt-3 text-[13px] text-body">
              出题人：{item.authorPid ? names[item.authorPid] : "未揭晓"}
            </p>
            {item.busted ? (
              <p className="mt-2 text-[13px] text-alarm">
                被 {item.bustedByPid ? names[item.bustedByPid] : "某人"} 识破
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <footer className="mt-8 pb-6 text-center text-[13px] tabular-nums text-dim">
        共 {total} 份 / 发出 {sent} / 作废 {voided}
      </footer>

      {sharing && shareData ? <ShareResultCard data={shareData} onClose={() => setSharing(false)} /> : null}
    </main>
  );
}
