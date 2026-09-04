"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Lookup {
  activityId: string;
  title: string;
  joined: boolean;
}

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [checking, setChecking] = useState(true);

  // 先问一句这个码是哪一局、我在不在里面。
  // 不问的话，已经在局里的人会被要求重填一次昵称，填完什么都没发生
  useEffect(() => {
    fetch(`/api/join/${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Lookup | null) => setLookup(d))
      .catch(() => setLookup(null))
      .finally(() => setChecking(false));
  }, [code]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!nickname.trim()) return setError("留下一个昵称，方便大家辨认。");
    const response = await fetch(`/api/join/${encodeURIComponent(code)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: nickname.trim() }),
    });
    if (!response.ok) return setError("邀请码不对，或者活动没了。");
    const data = (await response.json()) as { activityId: string };
    window.location.href = `/a/${data.activityId}`;
  }

  const upper = code.toUpperCase();

  if (checking) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
        <p className="text-[12px] tracking-[.3em] text-mark">邀请码 {upper}</p>
        <p className="mt-8 text-dim">正在寻找对应活动。</p>
      </main>
    );
  }

  if (lookup === null) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
        <a href="/join" className="text-[13px] text-dim">&lt; 换一个码</a>
        <p className="mt-6 text-[12px] tracking-[.3em] text-mark">邀请码 {upper}</p>
        <h1 className="mt-4 text-3xl font-bold text-bright">没有对应的活动。</h1>
        <p className="mt-4 text-[15px] leading-7 text-body">码填错了，或者这活动已经失效了。</p>
        <a href="/join" className="mt-auto flex min-h-14 items-center justify-center rounded-full bg-mark text-[16px] font-bold text-ground">
          重新填写
        </a>
      </main>
    );
  }

  if (lookup.joined) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
        <a href="/" className="text-[13px] text-dim">&lt; 回首页</a>
        <p className="mt-6 text-[12px] tracking-[.3em] text-mark">邀请码 {upper}</p>
        <h1 className="mt-4 text-3xl font-bold text-bright">你已经在这个活动里了。</h1>
        <p className="mt-4 text-[15px] leading-7 text-body">{lookup.title}</p>
        <div className="mt-auto grid gap-3">
          <a
            href={`/a/${lookup.activityId}`}
            className="flex min-h-14 items-center justify-center rounded-full bg-mark text-[16px] font-bold text-ground"
          >
            进入活动
          </a>
          <a
            href="/mine"
            className="flex min-h-14 items-center justify-center rounded-full border border-line text-[16px] font-bold text-bright"
          >
            查看我的活动
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
      <a href="/join" className="text-[13px] text-dim">&lt; 换一个码</a>
      <p className="mt-6 text-[12px] tracking-[.3em] text-mark">邀请码 {upper}</p>
      <h1 className="mt-4 text-3xl font-bold text-bright">
        填写你的昵称，仅在本局使用
        <br />
        方便其他人辨识。
      </h1>
      <p className="mt-4 text-[15px] text-dim">{lookup.title}</p>

      <form onSubmit={submit} className="mt-auto space-y-4 pb-4">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={20}
          placeholder="别人怎么叫你"
          aria-label="昵称"
          className="min-h-14 w-full rounded-xl border border-line bg-surface px-4 text-[16px] text-bright outline-none focus:border-mark"
        />
        <button className="min-h-14 w-full rounded-full bg-mark text-[16px] font-bold text-ground">
          加入活动
        </button>
        {error ? <p role="alert" className="text-[13px] text-alarm">{error}</p> : null}
      </form>
    </main>
  );
}
