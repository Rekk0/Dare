"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { RevealAssignmentDto } from "@/core/visibility";

type Settlement = { taskShares: string | number; bountyShares: string | number; totalShares: string | number; busted: boolean } | null;
export default function ResultPage() {
  const { id } = useParams<{ id: string }>(); const [items, setItems] = useState<RevealAssignmentDto[]>([]); const [mine, setMine] = useState<Settlement>(null); const [shown, setShown] = useState(0);
  useEffect(() => { Promise.all([fetch(`/api/activities/${id}/reveal`).then((r) => r.json()), fetch(`/api/activities/${id}/settlement`).then((r) => r.json())]).then(([reveal, settlement]) => { setItems(reveal.assignments); setMine(settlement); }).catch(() => undefined); }, [id]);
  useEffect(() => { if (shown >= items.length) return; const timer = window.setTimeout(() => setShown((n) => n + 1), 450); return () => window.clearTimeout(timer); }, [shown, items.length]);
  const total = items.length; const voided = items.filter((item) => item.busted).length; const sent = total - voided;
  return <main className="mx-auto min-h-[100dvh] max-w-[420px] px-5 py-8"><p className="text-[12px] tracking-[.3em] text-mark">结算</p><h1 className="mt-3 text-3xl font-bold text-bright">这一局，到账。</h1><div className="mt-8 space-y-3">{items.slice(0, shown).map((item, index) => <section key={item.assignmentId} className="rounded-2xl border border-line bg-surface p-4"><p className="text-[13px] text-dim">任务 {index + 1}</p><p className="mt-2 text-[16px] leading-7 text-bright">{item.taskContent ?? "任务正文仍在保密"}</p><p className="mt-3 text-[13px] text-body">出题人和执行者已揭晓{item.busted ? <span className="ml-2 rounded-full bg-alarm px-2 py-1 text-[11px] font-bold text-ground">已暴露</span> : null}</p></section>)}</div>{shown >= total ? <section className="mt-8 rounded-2xl border border-line bg-surface p-5"><p className="text-[13px] text-dim">你的份额</p><p className="mt-2 text-5xl font-display tabular-nums text-gain">{mine ? mine.totalShares : 0}</p><p className="mt-4 text-[14px] text-body">任务 {mine?.taskShares ?? 0} / 猜中 {mine?.bountyShares ?? 0}</p></section> : null}<footer className="mt-8 pb-6 text-center text-[13px] tabular-nums text-dim">共 {total} 份 / 发出 {sent} / 作废 {voided}</footer></main>;
}
