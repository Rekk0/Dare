"use client";

import { FormEvent, useState } from "react";

export default function Home() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function createActivity() {
    setError("");
    const now = Date.now();
    const response = await fetch("/api/activities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "今晚的暗任务",
        sceneType: "other",
        sceneDesc: "线下派对",
        startAt: new Date(now + 10 * 60_000).toISOString(),
        endAt: new Date(now + 130 * 60_000).toISOString(),
        voteDeadline: new Date(now + 160 * 60_000).toISOString(),
        shareDesc: "一份",
        bountyTiers: [0.5, 0.3, 0.2],
      }),
    });
    if (!response.ok) return setError("没建成，再试一次。");
    const data = await response.json() as { id: string };
    window.location.href = `/a/${data.id}`;
  }

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized) return setError("填邀请码。");
    window.location.href = `/a/${normalized}/join`;
  }

  return <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
    <p className="mt-10 text-[12px] font-bold tracking-[.32em] text-mark">DARE</p>
    <h1 className="mt-4 font-display text-6xl leading-[.92] text-bright">别让人<br />看见。</h1>
    <p className="mt-6 max-w-[24ch] text-[16px] leading-7 text-body">给朋友留一道暗任务。做成了拿走一份，被猜中就归零。</p>
    <div className="mt-auto space-y-4 pb-4">
      <button type="button" onClick={createActivity} className="min-h-14 w-full rounded-full bg-mark px-5 text-[16px] font-bold text-ground">建活动</button>
      <form onSubmit={join} className="rounded-2xl border border-line bg-surface p-4">
        <label htmlFor="invite" className="text-[13px] text-dim">有邀请码就进来</label>
        <div className="mt-3 flex gap-2"><input id="invite" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} placeholder="6 位邀请码" className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-ground px-3 text-bright outline-none focus:border-mark" /><button className="rounded-full border border-line px-4 font-bold text-bright">加入</button></div>
      </form>
      {error ? <p role="alert" className="text-[13px] text-alarm">{error}</p> : null}
    </div>
  </main>;
}
