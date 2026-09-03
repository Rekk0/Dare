"use client";

import { FormEvent, useState } from "react";
import { useParams } from "next/navigation";
import AiThinking from "@/components/AiThinking";

type Review = {
  verdict: "accept" | "revise" | "reject";
  canForceSubmit: boolean;
  /** 预审通过才有。确认提交时带回去验签，被拦的题拿不到 */
  token?: string;
  scores: {
    feasibility: number;
    stealth: number;
    fun: number;
    verifiability: number;
    safety: "ok" | "warn" | "block";
    reasons: string[];
    suggestions: string[];
  };
};

const scoreLabels = { feasibility: "可完成", stealth: "隐蔽", fun: "好玩", verifiability: "可留证" } as const;

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const [content, setContent] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** 上一次送去预审的原文。用来判断现在框里的字有没有被改过 */
  const [reviewedContent, setReviewedContent] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    let response: Response;
    try {
      response = await fetch(`/api/activities/${id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
    } catch {
      setPending(false);
      return setError("连不上服务器。检查网络，关掉 VPN 再试。");
    }
    setPending(false);
    if (!response.ok) {
      // 把「没连上」「身份丢了」「服务端炸了」分开报。
      // 三种情况显示同一句话的话，排查时完全没有方向。
      if (response.status === 403) return setError("你的身份没认出来。回首页重新用邀请码进一次。");
      if (response.status === 404) return setError("这局不在了。检查邀请码。");
      return setError(`没送进去（${response.status}）。再试一次。`);
    }
    setReview((await response.json()) as Review);
    setReviewedContent(content);
  }

  /** 预审完只是草稿，点了确认才进这一局 */
  async function confirmSubmit() {
    if (confirming) return;
    setError("");
    setConfirming(true);
    let response: Response;
    try {
      response = await fetch(`/api/activities/${id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true, content, token: review?.token }),
      });
    } catch {
      setConfirming(false);
      return setError("连不上服务器。检查网络，关掉 VPN 再试。");
    }
    if (!response.ok) {
      setConfirming(false);
      return setError("没交上去。重新预审一次再试。");
    }
    window.location.href = `/a/${id}`;
  }

  const blocked = review?.verdict === "reject";
  // 改了字之后那份评分和库里存的原文都对不上了。
  // 这时候还让点「确认提交」的话，确认下去的是改之前那道题
  const stale = review !== null && content !== reviewedContent;
  // safety=warn 的题照样能上，但攒局的人得看见提醒了什么，
  // 比如这题会把没参加游戏的人卷进来。不显示等于这个提醒白给。
  const warned = review?.scores.safety === "warn" && !blocked;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
      <a href={`/a/${id}`} className="text-[13px] text-dim">&lt; 回这一局</a>
      <p className="mt-6 text-[12px] tracking-[.3em] text-mark">写一道题</p>
      <h1 className="mt-3 text-3xl font-bold text-bright">让人做得到，<br />又不容易被猜到。</h1>

      <form onSubmit={submit} className="mt-8 flex flex-1 flex-col">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={500}
          placeholder="比如：想办法让左边的人主动说出一个动物名"
          className="min-h-40 w-full rounded-xl border border-line bg-surface p-4 leading-7 text-bright outline-none focus:border-mark"
        />

        {review && !stale ? (
          <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
            <p className={blocked ? "font-bold text-alarm" : "font-bold text-mark"}>
              {blocked ? "这题不行" : review.verdict === "revise" ? "能玩，但该改改" : "这题能上"}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {Object.entries(scoreLabels).map(([key, label]) => (
                <div key={key} className="rounded-xl bg-raised p-3">
                  <p className="text-[12px] text-dim">{label}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-bright">
                    {review.scores[key as keyof typeof scoreLabels]}
                  </p>
                </div>
              ))}
            </div>
            {review.verdict === "revise" ? (
              <p className="mt-4 text-[14px] leading-6 text-body">
                {review.scores.suggestions[0] ?? "把范围再收一点，别让人一眼就锁定答案。"}
              </p>
            ) : null}
            {warned ? (
              <p className="mt-4 border-l-2 border-alarm pl-3 text-[14px] leading-6 text-body">
                {review.scores.reasons[0] ?? "这题有点越界，自己掂量。"}
              </p>
            ) : null}
            {blocked ? <p className="mt-4 text-[14px] text-body">换个题。这里不给绕过。</p> : null}
          </section>
        ) : null}

        <div className="mt-auto pt-6">
          {review && !blocked ? (
            // 预审过了就给两条路：改了再看一遍，或者就按这题定下来。
            // 只留一个「提交并预审」的话，用户根本不知道自己该干什么
            <div className="grid grid-cols-2 gap-3">
              <button
                type="submit"
                disabled={pending || confirming || !content.trim()}
                className="min-h-14 rounded-full border border-line text-[15px] font-bold text-bright disabled:text-dim"
              >
                {pending ? "预审中" : "重新提交预审"}
              </button>
              <button
                type="button"
                onClick={confirmSubmit}
                disabled={pending || confirming || stale}
                className="min-h-14 rounded-full bg-mark text-[15px] font-bold text-ground disabled:bg-raised disabled:text-dim"
              >
                {confirming ? "提交中" : "确认提交"}
              </button>
            </div>
          ) : (
            <button
              disabled={pending || !content.trim() || blocked}
              className="min-h-14 w-full rounded-full bg-mark text-[16px] font-bold text-ground disabled:cursor-not-allowed disabled:bg-raised disabled:text-dim"
            >
              {pending ? "预审中" : "提交并预审"}
            </button>
          )}
          {pending ? (
            <div className="mt-4">
              <AiThinking label="AI 正在读这道题，几秒就好" />
            </div>
          ) : null}
          {stale && !pending ? (
            <p className="mt-3 text-[13px] text-dim">题改了，再预审一次才能提交。</p>
          ) : null}
          {error ? <p role="alert" className="mt-3 text-[13px] text-alarm">{error}</p> : null}
        </div>
      </form>
    </main>
  );
}
