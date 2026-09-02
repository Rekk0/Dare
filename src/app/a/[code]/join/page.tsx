"use client";

import { FormEvent, useState } from "react";
import { useParams } from "next/navigation";

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!nickname.trim()) return setError("留个名字，大家好认你。");
    const response = await fetch(`/api/activities/${encodeURIComponent(code)}/join`, { method: "POST" });
    if (!response.ok) return setError("邀请码不对，或者这局没了。");
    const data = await response.json() as { activityId: string };
    sessionStorage.setItem(`dare:nickname:${data.activityId}`, nickname.trim());
    window.location.href = `/a/${data.activityId}`;
  }
  return <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8"><p className="mt-10 text-[12px] tracking-[.3em] text-mark">邀请码 {code.toUpperCase()}</p><h1 className="mt-4 text-3xl font-bold text-bright">进这局前，<br />留个名字。</h1><form onSubmit={submit} className="mt-auto space-y-4 pb-4"><input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} placeholder="别人怎么叫你" className="min-h-14 w-full rounded-xl border border-line bg-surface px-4 text-[16px] text-bright outline-none focus:border-mark" /><button className="min-h-14 w-full rounded-full bg-mark text-[16px] font-bold text-ground">加入活动</button>{error ? <p role="alert" className="text-[13px] text-alarm">{error}</p> : null}</form></main>;
}
