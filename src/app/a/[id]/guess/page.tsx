"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AiThinking from "@/components/AiThinking";
import GuessResult from "@/components/GuessResult";
import type { GuessResultDto } from "@/core/visibility";

interface Roster {
  me: string;
  participants: { pid: string; nickname: string }[];
}

export default function GuessPage() {
  const { id } = useParams<{ id: string }>();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [targetPid, setTargetPid] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<GuessResultDto | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch(`/api/activities/${id}/participants`)
      .then((r) => r.json())
      .then((d: Roster) => setRoster(d))
      .catch(() => undefined);
  }, [id]);

  // 自己不能猜自己（明知完不成时猜自己能把 0 份变成 0.5 份），
  // 所以名单里直接把自己排除掉，不给点错的机会。服务端也拦了一道。
  const targets = roster
    ? roster.participants.filter((p) => p.pid !== roster.me)
    : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    const response = await fetch(`/api/activities/${id}/guesses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetPid, text }),
    });
    setPending(false);
    if (!response.ok) return setError("这次猜不了。换个对象或晚点再来。");
    setResult((await response.json()) as GuessResultDto);
  }

  // 猜完给出路：还有配额就能接着猜，也能直接回这一局
  if (result) {
    return (
      <GuessResult
        {...result}
        activityId={id}
        onAgain={() => { setResult(null); setText(""); setTargetPid(""); }}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
      <a href={`/a/${id}`} className="text-[13px] text-dim">&lt; 回这一局</a>
      <p className="mt-6 text-[12px] tracking-[.3em] text-mark">猜测</p>
      <h1 className="mt-3 text-3xl font-bold text-bright">你觉得他在干嘛？</h1>
      <p className="mt-3 text-[14px] leading-6 text-dim">
        猜中了，他那一份归你一部分。猜错不扣，但配额有限。
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-1 flex-col gap-4">
        <select
          value={targetPid}
          onChange={(e) => setTargetPid(e.target.value)}
          aria-label="选择猜测对象"
          className="min-h-14 rounded-xl border border-line bg-surface px-4 text-bright"
        >
          <option value="">选一个人</option>
          {targets.map((target) => (
            <option key={target.pid} value={target.pid}>
              {target.nickname}
            </option>
          ))}
        </select>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={80}
          placeholder="你猜他的任务是..."
          aria-label="猜测内容"
          className="min-h-32 rounded-xl border border-line bg-surface p-4 text-bright outline-none focus:border-mark"
        />
        <p className="text-right text-[12px] tabular-nums text-dim">
          {text.length} / 80
        </p>

        <div className="mt-auto">
          <button
            disabled={pending || !targetPid || !text.trim()}
            className="min-h-14 w-full rounded-full bg-mark font-bold text-ground disabled:bg-raised disabled:text-dim"
          >
            {pending ? "判定中" : "提交猜测"}
          </button>
          {pending ? (
            <div className="mt-4">
              <AiThinking label="AI 正在比对你猜的和他的题" />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-[13px] text-alarm">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </main>
  );
}
