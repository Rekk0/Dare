"use client";

import { useState } from "react";
import AiThinking from "@/components/AiThinking";
import { DEFAULT_POLICY, EDGINESS, type Edginess } from "@/core/review-policy";

const EDGINESS_LEVELS = [1, 2, 3] as const;

/** 预审下限的滑杆。三个维度长得一样，抽出来免得抄三遍 */
function Threshold({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-[13px] text-dim">
      {label} <span className="text-bright">{value}</span>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-mark"
      />
    </label>
  );
}

export default function NewActivityPage() {
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<{ field: string; message: string }[]>([]);
  const [title, setTitle] = useState("例：小明和朋友们的KTV派对");
  const [sceneDesc, setSceneDesc] = useState("例：小明和三两好友的KTV欢唱");
  const [minFeasibility, setMinFeasibility] = useState(DEFAULT_POLICY.minFeasibility);
  const [minStealth, setMinStealth] = useState(DEFAULT_POLICY.minStealth);
  const [minFun, setMinFun] = useState(DEFAULT_POLICY.minFun);
  const [minVerifiability, setMinVerifiability] = useState(DEFAULT_POLICY.minVerifiability);
  const [minPlayers, setMinPlayers] = useState(3);
  const [maxPlayers, setMaxPlayers] = useState(21);
  const [shareDesc, setShareDesc] = useState("例：十个金币");
  const [times, setTimes] = useState(() => { const n = Date.now(); const local = (ms: number) => new Date(n + ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16); return { taskDeadline: local(30 * 60_000), startAt: local(60 * 60_000), endAt: local(180 * 60_000), voteDeadline: local(240 * 60_000) }; });
  const [edginess, setEdginess] = useState<Edginess>(DEFAULT_POLICY.edginess);
  const [reason, setReason] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  async function createActivity() {
    setError("");
    setProblems([]);
    const response = await fetch("/api/activities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        sceneType: "other",
        sceneDesc,
        taskDeadline: new Date(times.taskDeadline).toISOString(), startAt: new Date(times.startAt).toISOString(), endAt: new Date(times.endAt).toISOString(), voteDeadline: new Date(times.voteDeadline).toISOString(), shareDesc,
        minPlayers, maxPlayers,
        bountyTiers: [0.5, 0.3, 0.2],
        minFeasibility,
        minStealth,
        minFun,
        minVerifiability,
        edginess,
      }),
    });
    if (!response.ok) {
      // 接口会逐条说清楚哪个字段不对。只显示一句「没建成」的话，
      // 用户只能挨个字段试，我在日志里也看不出是哪一条挂的
      const data = (await response.json().catch(() => null)) as { problems?: { field: string; message: string }[] } | null;
      if (data?.problems?.length) return setProblems(data.problems);
      return setError("没建成，再试一次。");
    }
    const data = (await response.json()) as { id: string };
    // 先去起名字。不走这一步的话创建者在名单上一直是 `玩家1234`，
    // 参与者填邀请码时留过名，创建者本来没有这个机会
    window.location.href = `/a/${data.id}/nickname`;
  }

  /** AI 只是把表单填上默认值，填完创建者照样能改 */
  async function suggest() {
    setSuggesting(true);
    setError("");
    try {
      const response = await fetch("/api/activities/suggest-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, sceneType: "other", sceneDesc, participantCount: 6 }),
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as {
        minFeasibility: number;
        minStealth: number;
        minFun: number;
        minVerifiability: number;
        edginess: Edginess;
        reason: string;
      };
      setMinFeasibility(data.minFeasibility);
      setMinStealth(data.minStealth);
      setMinFun(data.minFun);
      setMinVerifiability(data.minVerifiability);
      setEdginess(data.edginess);
      setReason(data.reason);
    } catch {
      setError("AI 未能响应，自己定也行。");
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
      <a href="/" className="text-[13px] text-dim">&lt; 回首页</a>
      <h1 className="mt-6 text-3xl font-bold text-bright">新建活动</h1>
      <p className="mt-3 text-[15px] leading-7 text-body">敲定活动详情。</p>

      <section className="mt-8 space-y-4 rounded-2xl border border-line bg-surface p-4">
        <label className="block text-[13px] text-dim">
          活动名称
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-bright outline-none focus:border-mark"
          />
        </label>

        <label className="block text-[13px] text-dim">
          这是个什么样的活动
          <textarea
            value={sceneDesc}
            onChange={(e) => setSceneDesc(e.target.value)}
            className="mt-2 min-h-16 w-full rounded-xl border border-line bg-ground p-3 text-bright outline-none focus:border-mark"
          />
        </label>

        <div>
          <p className="text-[13px] text-dim">尺度</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {EDGINESS_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setEdginess(level)}
                className={`min-h-11 rounded-full border border-line font-bold ${edginess === level ? "bg-mark text-ground" : "text-bright"}`}
              >
                {EDGINESS[level].label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] leading-5 text-dim">{EDGINESS[edginess].desc}</p>
        </div>

        <Threshold label="可完成度下限" value={minFeasibility} onChange={setMinFeasibility} />
        <Threshold label="隐蔽度下限" value={minStealth} onChange={setMinStealth} />
        <Threshold label="好玩下限" value={minFun} onChange={setMinFun} />
        <Threshold label="可留证下限" value={minVerifiability} onChange={setMinVerifiability} />

        <div className="grid grid-cols-2 gap-3"><label className="text-[13px] text-dim">人数下限<input type="number" min="3" max="21" value={minPlayers} onChange={(e) => setMinPlayers(Number(e.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-bright" /></label><label className="text-[13px] text-dim">人数上限<input type="number" min="3" max="21" value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-bright" /></label></div>
        <label className="block text-[13px] text-dim">每份奖励是什么<input value={shareDesc} onChange={(e) => setShareDesc(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-bright" /></label>
        {([ ["taskDeadline", "最晚出题时间"], ["startAt", "开始时间"], ["endAt", "结束时间"], ["voteDeadline", "投票截止"] ] as const).map(([key, label]) => <label key={key} className="block text-[13px] text-dim">{label}<input type="datetime-local" value={times[key]} onChange={(e) => setTimes({ ...times, [key]: e.target.value })} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-bright" /></label>)}

        <button
          type="button"
          onClick={suggest}
          disabled={suggesting}
          className="min-h-11 rounded-full border border-mark px-4 text-[14px] font-bold text-mark disabled:opacity-50"
        >
          {suggesting ? "AI 在看" : "让 AI 看看这个场景"}
        </button>
        {suggesting ? <AiThinking label="AI 正在琢磨这个场合能玩多大" /> : null}
        {reason ? <p className="text-[13px] leading-5 text-dim">{reason}</p> : null}

        {problems.length ? (
          <ul role="alert" className="grid gap-1 rounded-xl border border-alarm p-3">
            {problems.map((p) => (
              <li key={p.field + p.message} className="text-[13px] leading-5 text-alarm">{p.message}</li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          onClick={createActivity}
          className="min-h-14 w-full rounded-full bg-mark px-5 text-[16px] font-bold text-ground"
        >
          建活动
        </button>
      </section>

      {error ? <p role="alert" className="mt-3 text-[13px] text-alarm">{error}</p> : null}
    </main>
  );
}
