"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { RevealAssignmentDto } from "@/core/visibility";

export default function VotePage() {
  const { id } = useParams<{ id: string }>(); const [items, setItems] = useState<RevealAssignmentDto[]>([]); const [done, setDone] = useState<string[]>([]);
  useEffect(() => { fetch(`/api/activities/${id}/reveal`).then((r) => r.json()).then((d: { assignments: RevealAssignmentDto[] }) => setItems(d.assignments)).catch(() => undefined); }, [id]);
  async function vote(assignmentId: string, verdict: "pass" | "fail") { const response = await fetch(`/api/assignments/${assignmentId}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verdict }) }); if (response.ok) setDone((old) => [...old, assignmentId]); }
  return <main className="mx-auto min-h-[100dvh] max-w-[420px] px-5 py-8"><p className="text-[12px] tracking-[.3em] text-mark">公投</p><h1 className="mt-3 text-3xl font-bold text-bright">看证据，投一票。</h1><div className="mt-8 space-y-3">{items.map((item, index) => <section key={item.assignmentId} className="rounded-2xl border border-line bg-surface p-4"><p className="text-[13px] text-dim">玩家 {index + 1}</p>{item.busted ? <p className="mt-3 font-bold text-alarm">已被识破</p> : item.canVote ? done.includes(item.assignmentId) ? <p className="mt-3 text-body">你投完了。</p> : <div className="mt-4 grid grid-cols-2 gap-3"><button onClick={() => vote(item.assignmentId, "pass")} className="min-h-12 rounded-full bg-mark font-bold text-ground">算过</button><button onClick={() => vote(item.assignmentId, "fail")} className="min-h-12 rounded-full border border-line font-bold text-bright">不算</button></div> : null}</section>)}</div></main>;
}
