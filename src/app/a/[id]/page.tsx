"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import BustedScreen from "@/components/BustedScreen";
import TaskCard from "@/components/TaskCard";
import type { MyAssignmentDto } from "@/core/visibility";

type Activity = { title: string; endAt: string; status: string };
export default function ActivityPage() {
  const { id } = useParams<{ id: string }>(); const [activity, setActivity] = useState<Activity | null>(null); const [assignment, setAssignment] = useState<MyAssignmentDto | null>(null); const [showBusted, setShowBusted] = useState(false);
  useEffect(() => { Promise.all([fetch(`/api/activities/${id}`).then((r) => r.json()), fetch(`/api/activities/${id}/my-assignment`).then((r) => r.json())]).then(([a, m]) => { setActivity(a); setAssignment(m); if (m.busted && !sessionStorage.getItem(`dare:busted:${m.assignmentId}`)) setShowBusted(true); }).catch(() => undefined); }, [id]);
  function dismiss() { if (assignment) sessionStorage.setItem(`dare:busted:${assignment.assignmentId}`, "1"); setShowBusted(false); }
  if (showBusted) return <BustedScreen onContinue={dismiss} onDismiss={dismiss} />;
  return <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8"><p className="text-[12px] tracking-[.3em] text-mark">活动进行中</p><h1 className="mt-3 text-3xl font-bold text-bright">{activity?.title ?? "正在接上这局"}</h1><div className="mt-8">{assignment && activity ? <TaskCard assignment={assignment} endAt={new Date(activity.endAt)} onUpload={() => window.location.href = `/a/${id}/vote`} onGuess={() => window.location.href = `/a/${id}/guess`} /> : <p className="text-dim">正在拿你的任务。</p>}</div><div className="mt-auto grid grid-cols-2 gap-3 pt-8"><a href={`/a/${id}/task`} className="min-h-12 rounded-full border border-line py-3 text-center font-bold text-bright">出题</a><a href={`/a/${id}/vote`} className="min-h-12 rounded-full border border-line py-3 text-center font-bold text-bright">去投票</a></div></main>;
}
