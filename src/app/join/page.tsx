"use client";

import { FormEvent, useState } from "react";

/**
 * 输入邀请码。
 *
 * 这一页只收码，收完跳 /join/[code] 去填昵称。
 * 两步分开是因为码是别人给的、昵称是自己起的，混在一屏里
 * 用户会分不清哪个字段该填什么。
 */
export default function JoinCodePage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized.length !== 6) return setError("邀请码是 6 位。");
    window.location.href = `/join/${normalized}`;
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
      <a href="/" className="text-[13px] text-dim">&lt; 回首页</a>
      <h1 className="mt-6 text-3xl font-bold text-bright">
        谁给你的码，
        <br />
        填这儿。
      </h1>

      <form onSubmit={submit} className="mt-auto pb-4">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(""); }}
          maxLength={6}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="6 位邀请码"
          aria-label="邀请码"
          className="min-h-16 w-full rounded-xl border border-line bg-surface px-4 text-center text-3xl font-bold uppercase tracking-[.28em] tabular-nums text-bright outline-none placeholder:text-[16px] placeholder:font-normal placeholder:tracking-normal placeholder:text-dim focus:border-mark"
        />
        <button className="mt-4 min-h-14 w-full rounded-full bg-mark text-[16px] font-bold text-ground">
          进这一局
        </button>
        {error ? <p role="alert" className="mt-3 text-[13px] text-alarm">{error}</p> : null}
      </form>
    </main>
  );
}
