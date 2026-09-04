"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

/**
 * 设置自己在这一局里的名字。
 *
 * 建局的人本来没有这一步：参与者填邀请码时会顺手留个名字，
 * 创建者直接就进局了，名单上一直挂着 `玩家1234`。
 *
 * 这里改的是 participants.nickname，只管这一局。
 */
export default function NicknamePage() {
  const { id } = useParams<{ id: string }>();
  const [nickname, setNickname] = useState("");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // 名册接口顺带告诉我 me 是哪一行，用它把现在的名字填进输入框，
    // 这样这个页面也能当改名页用
    Promise.all([
      fetch(`/api/activities/${id}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/activities/${id}/participants`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([activity, roster]) => {
        if (activity) {
          setTitle(activity.title ?? "");
          setCode(activity.code ?? "");
        }
        const mine = roster?.participants?.find(
          (p: { pid: string }) => p.pid === roster.me,
        );
        if (mine?.nickname) setNickname(mine.nickname);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const name = nickname.trim();
    if (!name) return setError("留个名字，大家好认你。");

    setSaving(true);
    const response = await fetch(`/api/activities/${id}/participants`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: name }),
    });
    if (!response.ok) {
      setSaving(false);
      return setError("没存上，再试一次。");
    }
    window.location.href = `/a/${id}`;
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
        <p className="mt-8 text-dim">正在打开这一局。</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
      {code ? (
        <p className="text-[12px] tracking-[.3em] text-mark">邀请码 {code}</p>
      ) : null}
      <h1 className="mt-4 text-3xl font-bold text-bright">
        这一局里，
        <br />
        你叫什么。
      </h1>
      {title ? <p className="mt-4 text-[15px] text-dim">{title}</p> : null}
      <p className="mt-4 text-[15px] leading-7 text-body">
        只在这一局用。换一局可以换个名字。
      </p>

      <form onSubmit={submit} className="mt-auto space-y-4 pb-4">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={20}
          placeholder="别人怎么叫你"
          aria-label="昵称"
          className="min-h-14 w-full rounded-xl border border-line bg-surface px-4 text-[16px] text-bright outline-none focus:border-mark"
        />
        <button
          disabled={saving}
          className="min-h-14 w-full rounded-full bg-mark text-[16px] font-bold text-ground disabled:opacity-60"
        >
          {saving ? "存着" : "就叫这个"}
        </button>
        {error ? <p role="alert" className="text-[13px] text-alarm">{error}</p> : null}
      </form>
    </main>
  );
}
