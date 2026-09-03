"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EvidenceLightbox, EvidenceThumb, useEvidenceViewer } from "@/components/EvidenceViewer";
import type { RevealAssignmentDto } from "@/core/visibility";

export default function VotePage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<RevealAssignmentDto[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const viewer = useEvidenceViewer();

  useEffect(() => {
    fetch(`/api/activities/${id}/reveal`)
      .then((r) => r.json())
      .then((data: { assignments: RevealAssignmentDto[] }) => setItems(data.assignments))
      .catch(() => undefined);
  }, [id]);

  async function vote(assignmentId: string, verdict: "pass" | "fail") {
    const response = await fetch(`/api/assignments/${assignmentId}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict }),
    });
    if (response.ok) setDone((old) => [...old, assignmentId]);
  }

  return (
    <main className="mx-auto min-h-[100dvh] max-w-[420px] px-5 py-8">
      <a href={`/a/${id}`} className="text-[13px] text-dim">&lt; 回这一局</a>
      <p className="mt-6 text-[12px] tracking-[.3em] text-mark">公投</p>
      <h1 className="mt-3 text-3xl font-bold text-bright">看证据，投一票。</h1>
      <div className="mt-8 space-y-3">
        {items.map((item, index) => (
          <section key={item.assignmentId} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[13px] text-dim">玩家 {index + 1}</p>
            {item.evidence.length > 0 ? (
              <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
                {item.evidence.map((evidence, n) => <EvidenceThumb key={evidence.id} item={evidence} label={`第 ${n + 1} 份证据`} onOpen={viewer.open} />)}
              </div>
            ) : <p className="mt-3 text-sm text-dim">这份没交证据。</p>}
            <p className="mt-4 text-sm leading-6 text-body">
              {item.aiReport?.summary ?? "AI 还没看完这份"}
            </p>
            {item.busted ? <p className="mt-3 font-bold text-alarm">已被识破</p> : null}
            {!item.busted && item.canVote ? (
              done.includes(item.assignmentId) ? <p className="mt-3 text-body">你投完了。</p> : (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button onClick={() => vote(item.assignmentId, "pass")} className="min-h-12 rounded-full bg-mark font-bold text-ground">算过</button>
                  <button onClick={() => vote(item.assignmentId, "fail")} className="min-h-12 rounded-full border border-line font-bold text-bright">不算</button>
                </div>
              )
            ) : null}
          </section>
        ))}
      </div>
      <EvidenceLightbox item={viewer.zoomed} onClose={viewer.close} />
    </main>
  );
}
