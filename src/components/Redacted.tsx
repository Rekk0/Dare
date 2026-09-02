"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * 整块涂黑的任务卡内容。规格见 DESIGN.md §6.1。
 *
 * 两种手势防的不是同一个威胁：
 *   按住 800ms  全文显示，松手瞬间盖回：防「什么时候看」，你自己挑安全时机
 *   点一下      逐字显示、逐字渐隐    ：防「被瞟一眼」，任何瞬间只有约 5 个字在屏上
 *   播放中再点  立刻全清              ：急停。有人凑过来时的唯一出路
 *
 * 必须整块盖，绝不能只盖关键词：留着「在包厢里，让 ██ 的人主动唱一首 ██」这样的骨架，
 * 邻座扫一眼就能补全。部分防窥等于没有防窥。
 */

export const DEFAULT_STEP_MS = 150;
export const DEFAULT_DWELL_MS = 800;
const HOLD_MS = 800;
/** 逐字放完后，最后一个字渐隐完再复位。需要 >= CSS 里的渐隐时长 420ms */
const TAIL_MS = 500;

/**
 * 按书写单元切分，不按字符。
 *
 * 中文一字一个单元，但连续的 ASCII 字母数字要合成一个单元 ：
 * 「API」一个字母一个字母冒出来是坏的。字素簇同时正确处理 emoji 和组合字符
 * （否则 emoji 的代理对会被拆成两个乱码单元）。
 */
export function segmentUnits(text: string): string[] {
  let graphemes: string[];
  const Segmenter = (
    Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter }
  ).Segmenter;

  if (typeof Segmenter === "function") {
    const seg = new Segmenter("zh", { granularity: "grapheme" });
    graphemes = Array.from(seg.segment(text), (s) => s.segment);
  } else {
    graphemes = Array.from(text);
  }

  const isAscii = (s: string) => /^[A-Za-z0-9]+$/.test(s);
  const out: string[] = [];
  for (const g of graphemes) {
    const last = out[out.length - 1];
    if (isAscii(g) && last !== undefined && isAscii(last)) {
      out[out.length - 1] = last + g;
    } else {
      out.push(g);
    }
  }
  return out;
}

/** 黑条的行宽。模拟一份被涂黑的文件，不是等宽的进度条。 */
function barWidths(unitCount: number): string[] {
  const perLine = 14;
  const lines = Math.max(1, Math.ceil(unitCount / perLine));
  const widths: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (i < lines - 1) {
      widths.push(i % 2 === 0 ? "100%" : "94%");
    } else {
      const rest = unitCount - (lines - 1) * perLine;
      const pct = Math.max(28, Math.round((rest / perLine) * 100));
      widths.push(`${pct}%`);
    }
  }
  return widths;
}

export interface RedactedProps {
  text: string;
  /** 出字间隔。可见窗口 = dwell / step，默认约 5.3 个字（真机调出来的） */
  stepMs?: number;
  /** 每个字停留多久开始渐隐 */
  dwellMs?: number;
  className?: string;
  /** 手势状态变化时回调，用于外层更新提示文案 */
  onModeChange?: (mode: "idle" | "typing" | "hold") => void;
  /** 事件日志，真机排查用。生产环境不传 */
  onEvent?: (line: string) => void;
}

export default function Redacted({
  text,
  stepMs = DEFAULT_STEP_MS,
  dwellMs = DEFAULT_DWELL_MS,
  className,
  onModeChange,
  onEvent,
}: RedactedProps) {
  const units = useMemo(() => segmentUnits(text), [text]);
  const widths = useMemo(() => barWidths(units.length), [units.length]);

  /**
   * 挂载后才渲染文字 spans。两个原因，都很实在：
   *
   * 1. **避免 hydration mismatch。** Intl.Segmenter 在服务端（Node 的 ICU）
   *    和各家手机浏览器的 ICU 上可能切出不同的单元数，span 数量对不上就是
   *    hydration 失败。失败之后 React 不接管，页面看着正常但一个监听都没绑，
   *    表现就是「点和按都完全没反应」。
   *
   * 2. **避免 JS 接管前闪一下全文。** SSR 把全文渲染出来的话，
   *    首屏到 hydration 之间有一个窗口是全文可见的，那是防窥的破绽。
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const rootRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const unitRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const typeTimers = useRef<number[]>([]);
  const holdTimer = useRef<number | null>(null);
  const typing = useRef(false);
  const held = useRef(false);

  /**
   * 显隐一律走内联样式，不用 `.rdt[data-mode=x] .rdt-unit` 这类后代属性选择器。
   *
   * 任务内容的显隐是这个产品的安全关键路径。内联样式是单一事实来源：
   * 状态直接写在元素上，不依赖浏览器对属性变化重算后代选择器，
   * 也不会被后续加入的样式表规则意外覆盖。逐字的快出慢隐、
   * 长按的瞬间全显、松手的瞬间盖回，三种时长在这里显式区分。
   */
  const paint = useCallback((el: HTMLElement | null, on: boolean, instant: boolean) => {
    if (!el) return;
    el.style.transition = instant
      ? "none"
      : `opacity ${on ? 80 : 420}ms linear`; // 出字快，渐隐慢
    el.style.opacity = on ? "1" : "0";
  }, []);

  const setMode = useCallback(
    (mode: "idle" | "typing" | "hold") => {
      const root = rootRef.current;
      if (root) {
        root.setAttribute("data-mode", mode);
        // 黑条：非 idle 时让开。同样走内联，不靠选择器。
        const bars = root.querySelector<HTMLElement>(".rdt-bars");
        if (bars) {
          bars.style.transition = "opacity 120ms linear";
          bars.style.opacity = mode === "idle" ? "1" : "0";
        }
      }
      onEvent?.(`mode=${mode}`);
      onModeChange?.(mode);
    },
    [onModeChange, onEvent],
  );

  const clearTyping = useCallback(() => {
    typeTimers.current.forEach((t) => window.clearTimeout(t));
    typeTimers.current = [];
    typing.current = false;
    // 复位必须是瞬间的，不能让盖回也走 420ms 渐隐
    for (const el of unitRefs.current) paint(el, false, true);
    setMode("idle");
  }, [setMode, paint]);

  const startTyping = useCallback(() => {
    clearTyping();
    typing.current = true;
    setMode("typing");
    // 逐字的时序是安全机制不是装饰。减弱动效只去掉渐变，时序原样保留 ：
    // 绝不能因为用户开了减弱动效就把全文一次性显示出来。
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    unitRefs.current.forEach((el, i) => {
      if (!el) return;
      typeTimers.current.push(
        window.setTimeout(() => paint(el, true, instant), i * stepMs),
      );
      typeTimers.current.push(
        window.setTimeout(() => paint(el, false, instant), i * stepMs + dwellMs),
      );
    });
    typeTimers.current.push(
      window.setTimeout(
        clearTyping,
        units.length * stepMs + dwellMs + TAIL_MS,
      ),
    );
  }, [clearTyping, setMode, stepMs, dwellMs, units.length]);

  const onDown = useCallback(
    (e: React.PointerEvent | React.KeyboardEvent) => {
      // 只对鼠标和键盘 preventDefault（挡掉拖拽选中）。
      // 触摸上不要拦：iOS Safari 里 pointerdown 被 preventDefault 之后
      // 可能不再补发 pointerup，手势就整个死了。
      // 触摸的滚动和长按菜单由 CSS 的 touch-action / user-select /
      // -webkit-touch-callout 负责，不需要靠 preventDefault。
      const isTouch = "pointerType" in e && e.pointerType === "touch";
      if (!isTouch && "cancelable" in e && e.cancelable) e.preventDefault();
      if (holdTimer.current !== null) return;
      progressRef.current?.setAttribute("data-filling", "1");
      holdTimer.current = window.setTimeout(() => {
        held.current = true;
        clearTyping();
        setMode("hold");
        // 全显是瞬间的，不做渐入
        for (const el of unitRefs.current) paint(el, true, true);
      }, HOLD_MS);
    },
    [clearTyping, setMode, paint],
  );

  const onUp = useCallback(() => {
    const wasHold = held.current;
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    held.current = false;
    progressRef.current?.setAttribute("data-filling", "0");

    if (wasHold) {
      // 松手瞬间盖回，不走渐隐
      clearTyping();
      return;
    }
    // 短按：播放中则急停，否则开始逐字
    if (typing.current) clearTyping();
    else startTyping();
  }, [clearTyping, setMode, startTyping]);

  const onCancel = useCallback(() => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    held.current = false;
    progressRef.current?.setAttribute("data-filling", "0");
    clearTyping();
  }, [clearTyping]);

  /**
   * pointerleave 只对鼠标算「移出取消」。
   *
   * 触摸设备上，pointerup 之后浏览器会紧接着补发 pointerout / pointerleave
   * （触摸指针抬起后就被移除了）。如果照单全收，onUp 刚启动的逐字动画会被
   * 立刻清掉，表现就是「点了完全没反应」。
   * 鼠标上 pointerleave 只在真的移出元素时才触发，所以桌面测不出来。
   */
  const onLeave = useCallback(
    (e: React.PointerEvent) => {
      onEvent?.(`leave(${e.pointerType})`);
      if (e.pointerType === "mouse") onCancel();
    },
    [onCancel, onEvent],
  );

  // 卸载时清掉所有定时器，否则组件消失后还在改已经不存在的节点
  useEffect(() => {
    return () => {
      typeTimers.current.forEach((t) => window.clearTimeout(t));
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    };
  }, []);

  // 文本变了要复位，否则旧文本的定时器会点亮新文本的字
  useEffect(() => {
    onCancel();
  }, [text, onCancel]);

  return (
    // data-mode / data-on / data-filling 全部只用 setAttribute 命令式设置，
    // 绝不写成 JSX 属性。写成 JSX 属性的话，onModeChange 触发父组件重渲染时，
    // React 会把 JSX 里的值刷回 DOM，把命令式设的状态整个冲掉。
    // CSS 的默认态（无属性 = 已涂黑）本来就是正确的初始值，不需要渲染初始属性。
    <div
      ref={rootRef}
      className={`rdt ${className ?? ""}`}
      tabIndex={0}
      role="button"
      aria-label="点击逐字显示任务，长按显示全文"
      onPointerDown={(e) => {
        onEvent?.(`down(${e.pointerType})`);
        onDown(e);
      }}
      onPointerUp={(e) => {
        onEvent?.(`up(${e.pointerType})`);
        onUp();
      }}
      onPointerLeave={onLeave}
      onPointerCancel={(e) => {
        onEvent?.(`cancel(${e.pointerType})`);
        onCancel();
      }}
      onContextMenu={(e) => {
        onEvent?.("contextmenu");
        e.preventDefault();
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) onDown(e);
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onUp();
        }
      }}
    >
      {/* 屏幕阅读器拿全文。定时视觉揭示对读屏用户没有意义，
          长按是无障碍路径，打字机是纯视觉的可选模式。 */}
      <span className="sr-only">{text}</span>

      {/* SSR 阶段没有文字，高度会塌掉导致挂载时跳版。
          按行数预留出最终高度：15px 字号 x 1.9 行高 = 28.5px 一行 */}
      <p
        className="m-0 text-[15px] leading-[1.9] text-bright"
        style={{ minHeight: `${widths.length * 28.5}px` }}
        aria-hidden="true"
      >
        {mounted
          ? units.map((u, i) => (
              <span
                key={i}
                ref={(el) => {
                  unitRefs.current[i] = el;
                }}
                className="rdt-unit"
              >
                {u}
              </span>
            ))
          : // SSR 阶段只占位，不渲染任何文字。高度靠黑条撑住
            null}
      </p>

      <div className="rdt-bars" aria-hidden="true">
        {widths.map((w, i) => (
          <i key={i} style={{ width: w }} />
        ))}
      </div>

      <div ref={progressRef} className="rdt-progress" aria-hidden="true" />
    </div>
  );
}
