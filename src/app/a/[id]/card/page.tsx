"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import BustedScreen from "@/components/BustedScreen";
import TaskCard from "@/components/TaskCard";
import type { MyAssignmentDto } from "@/core/visibility";

/**
 * 任务卡单独一页。
 *
 * 从详情页拆出来，是因为详情页现在是这一局的枢纽（状态、五个入口、分享），
 * 任务卡铺在上面会把枢纽挤没。BUSTED 拦截跟着任务卡走，
 * 只在真正去看任务的那一刻拦。
 */
export default function CardPage() {
  const { id } = useParams<{ id: string }>();
  const [assignment, setAssignment] = useState<MyAssignmentDto | null>(null);
  const [endAt, setEndAt] = useState<Date | null>(null);
  const [busted, setBusted] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/activities/${id}/my-assignment`),
      fetch(`/api/activities/${id}`),
    ])
      .then(async ([mineResponse, activityResponse]) => {
        if (!mineResponse.ok) return;
        const mine = (await mineResponse.json()) as MyAssignmentDto;
        const activity = (await activityResponse.json()) as { endAt: string };
        setAssignment(mine);
        setEndAt(new Date(activity.endAt));
        // 同一次会话里只拦一次，看过就不再糊脸
        if (mine.busted && !sessionStorage.getItem(`dare:busted:${mine.assignmentId}`)) {
          setBusted(true);
        }
      })
      .catch(() => undefined);
  }, [id]);

  function dismiss() {
    if (assignment) sessionStorage.setItem(`dare:busted:${assignment.assignmentId}`, "1");
    setBusted(false);
  }

  if (busted) return <BustedScreen onContinue={dismiss} onDismiss={dismiss} />;

  return (
    <main className="mx-auto min-h-[100dvh] max-w-[420px] px-5 py-8">
      <a href={`/a/${id}`} className="text-[13px] text-dim">&lt; 回这一局</a>
      <h1 className="mt-6 text-3xl font-bold text-bright">我的任务卡</h1>
      {assignment && endAt ? (
        <div className="mt-8">
          <TaskCard
            assignment={assignment}
            endAt={endAt}
            onUpload={() => { window.location.href = `/a/${id}/upload`; }}
            onGuess={() => { window.location.href = `/a/${id}/guess`; }}
          />
        </div>
      ) : (
        <p className="mt-8 text-dim">还没分到任务。</p>
      )}
    </main>
  );
}
