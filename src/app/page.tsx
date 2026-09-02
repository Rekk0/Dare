"use client";

import { useCallback, useEffect, useState } from "react";
import Redacted, { DEFAULT_DWELL_MS, DEFAULT_STEP_MS } from "@/components/Redacted";

/**
 * M0 Spike C 的真机验证页。规格见 DESIGN.md §6.1。
 *
 * 带参数滑杆是刻意的：可见窗口（dwell / step）是这个机制唯一靠手感定的参数，
 * 露太多等于显示半句，露太少要反复重放。必须在真机上调，不能拍脑袋。
 */

const SAMPLE = "在包厢里，想办法让坐你右边的人主动唱一首粤语歌，全程不能提到「唱」这个字。";

const MODE_HINT: Record<string, string> = {
  idle: "点一下 逐字 · 按住 全显",
  typing: "再点一下可全清",
  hold: "松手隐藏",
};

export default function SpikePage() {
  const [step, setStep] = useState(DEFAULT_STEP_MS);
  const [dwell, setDwell] = useState(DEFAULT_DWELL_MS);
  const [mode, setMode] = useState("idle");
  const [log, setLog] = useState<string[]>([]);
  // SSR 出来是 false。翻不成 true 就说明 React 根本没接管这个页面
  const [hydrated, setHydrated] = useState(false);
  const [jsError, setJsError] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
    const onErr = (e: ErrorEvent) => setJsError(`${e.message} @ ${e.filename}:${e.lineno}`);
    const onRej = (e: PromiseRejectionEvent) => setJsError(`未处理的 Promise: ${String(e.reason)}`);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  // 真机排查用。手势没反应时把这块念出来就知道是哪个环节断的
  const pushLog = useCallback((line: string) => {
    const t = new Date().toISOString().slice(17, 23);
    setLog((prev) => [`${t} ${line}`, ...prev].slice(0, 10));
  }, []);

  const windowChars = (dwell / step).toFixed(1);
  const totalMs = Array.from(SAMPLE).length * step + dwell + 500;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col gap-7 px-5 py-10">
      <header className="flex flex-none flex-col gap-1">
        <p className="font-mono text-[10px] tracking-[0.28em] text-mark uppercase">
          Spike C
        </p>
        <h1 className="font-display text-[30px] leading-tight text-bright">
          任务卡揭示
        </h1>
      </header>

      {/* React 有没有接管。翻不成绿色就说明 hydration 挂了，
          页面看着正常但一个事件监听都没绑上 */}
      <div
        className="rounded-xl border px-4 py-3 font-mono text-[11px] leading-relaxed"
        style={{
          borderColor: hydrated ? "var(--gain)" : "var(--alarm)",
          color: hydrated ? "var(--gain)" : "var(--alarm)",
        }}
      >
        {hydrated ? "JS 已接管，手势应当可用" : "JS 未接管，手势不会有任何反应"}
        {jsError ? (
          <div className="mt-2 whitespace-pre-wrap text-alarm">报错: {jsError}</div>
        ) : null}
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="mb-3 font-mono text-[9px] tracking-[0.2em] text-dim">你的任务</p>
        <Redacted
          text={SAMPLE}
          stepMs={step}
          dwellMs={dwell}
          onModeChange={setMode}
          onEvent={pushLog}
        />
        <p className="mt-11 text-center font-mono text-[9.5px] tracking-[0.16em] text-dim">
          {MODE_HINT[mode]}
        </p>
      </section>

      <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-bright">可见窗口</span>
          <span className="font-mono text-[22px] text-mark tabular-nums">
            {windowChars} 字
          </span>
        </div>

        <label className="flex flex-col gap-2">
          <span className="flex justify-between font-mono text-[11px] text-dim">
            <span>出字间隔 step</span>
            <span className="text-body tabular-nums">{step}ms</span>
          </span>
          <input
            type="range"
            min={50}
            max={260}
            step={10}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            className="accent-[var(--mark)]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="flex justify-between font-mono text-[11px] text-dim">
            <span>停留 dwell</span>
            <span className="text-body tabular-nums">{dwell}ms</span>
          </span>
          <input
            type="range"
            min={300}
            max={2400}
            step={50}
            value={dwell}
            onChange={(e) => setDwell(Number(e.target.value))}
            className="accent-[var(--mark)]"
          />
        </label>

        <p className="font-mono text-[10.5px] leading-relaxed text-dim tabular-nums">
          全程 {(totalMs / 1000).toFixed(1)}s · 共 {Array.from(SAMPLE).length} 字
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-bold text-bright">事件日志</span>
          <button
            type="button"
            onClick={() => setLog([])}
            className="font-mono text-[10px] tracking-[0.14em] text-dim underline"
          >
            清空
          </button>
        </div>
        <p className="text-[11.5px] leading-relaxed text-dim">
          手势没反应时，把下面这几行念给 Claude，就知道是哪个环节断的。
        </p>
        <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-[1.7] text-body">
{log.length ? log.join("\n") : "（还没有事件，试着点一下或按住上面的任务卡）"}
        </pre>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5 text-[12.5px] leading-relaxed text-dim">
        <p className="text-[13px] font-bold text-bright">真机上逐条确认</p>
        <p>按住 800ms 全显，松手瞬间盖回</p>
        <p>点一下逐字显示、逐字渐隐</p>
        <p>播放中再点一下立刻全清</p>
        <p>长按和点击不误判，滚动时不误触发</p>
        <p>不唤起系统文本选择、放大镜、右键菜单</p>
        <p>逐字过程中文字不跳版</p>
      </section>
    </main>
  );
}
