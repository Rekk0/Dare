"use client";

import { useEffect, useState } from "react";

export interface BustedScreenProps {
  onContinue?: () => void;
  onDismiss?: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function BustedScreen({ onContinue, onDismiss }: BustedScreenProps) {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const vibration = window.setTimeout(() => navigator.vibrate?.([40, 30, 60]), 300);
    return () => window.clearTimeout(vibration);
  }, [reducedMotion]);

  return (
    <main className={`busted-screen ${reducedMotion ? "busted-screen--still" : ""}`} aria-label="任务已暴露">
      <style>{`
        .busted-screen { position: fixed; inset: 0; z-index: 50; display: flex; min-height: 100dvh; flex-direction: column; justify-content: flex-end; overflow: hidden; background: var(--redact); color: var(--bright); }
        .busted-screen::before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at center, color-mix(in srgb, var(--alarm) 68%, transparent), transparent 68%); opacity: 0; animation: busted-red 1400ms ease-out forwards; }
        .busted-screen::after { content: ""; position: absolute; inset: 0; background: var(--bright); opacity: 0; animation: busted-flash 320ms linear forwards; pointer-events: none; }
        .busted-content { position: relative; z-index: 1; display: flex; min-height: 100dvh; flex-direction: column; justify-content: flex-end; padding: 32px 24px max(32px, env(safe-area-inset-bottom)); animation: busted-shake 120ms steps(3, end) 300ms both; }
        .busted-title { margin: 0; width: 80%; font-family: var(--font-display); font-size: clamp(64px, 22vw, 120px); line-height: .9; color: var(--bright); animation: busted-title 220ms cubic-bezier(.2, 1.6, .4, 1) 260ms both; }
        .busted-kicker { margin: 16px 0 0; font-size: 12px; font-weight: 700; letter-spacing: .52em; color: var(--alarm); opacity: 0; animation: busted-fade-up 200ms ease-out 500ms forwards; }
        .busted-copy { margin-top: 36px; font-size: 17px; line-height: 1.65; color: var(--bright); }
        .busted-copy p { margin: 0; opacity: 0; transform: translateY(12px); animation: busted-fade-up 220ms ease-out forwards; }
        .busted-copy p:nth-child(1) { animation-delay: 700ms; }.busted-copy p:nth-child(2) { animation-delay: 830ms; }.busted-copy p:nth-child(3) { margin-top: 18px; color: var(--body); animation-delay: 960ms; }
        .busted-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 42px; opacity: 0; transform: translateY(32px); animation: busted-actions 300ms ease-out 1100ms forwards; }
        .busted-actions button { min-height: 52px; border-radius: 999px; padding: 0 14px; font-size: 15px; font-weight: 700; }.busted-actions button:first-child { border: 1px solid var(--line); color: var(--bright); }.busted-actions button:last-child { background: var(--mark); color: var(--ground); }
        @keyframes busted-red { 0%, 14% { opacity: 0; } 24% { opacity: 1; } 100% { opacity: .22; } } @keyframes busted-flash { 0%, 62% { opacity: 0; } 66% { opacity: 1; } 74% { opacity: 0; } 82% { opacity: .55; } 100% { opacity: 0; } } @keyframes busted-title { from { opacity: 0; transform: scale(1.75); } 75% { opacity: 1; transform: scale(.94); } to { opacity: 1; transform: scale(1); } } @keyframes busted-fade-up { to { opacity: 1; transform: translateY(0); } } @keyframes busted-actions { to { opacity: 1; transform: translateY(0); } } @keyframes busted-shake { 0%, 100% { transform: translateX(0); } 33% { transform: translateX(-5px); } 66% { transform: translateX(5px); } }
        .busted-screen--still::before { opacity: .22; animation: none; }.busted-screen--still::after { display: none; }.busted-screen--still .busted-content, .busted-screen--still .busted-title, .busted-screen--still .busted-kicker, .busted-screen--still .busted-copy p, .busted-screen--still .busted-actions { opacity: 1; transform: none; animation: none; }
      `}</style>
      <div className="busted-content">
        <h1 className="busted-title">暴露了</h1>
        <p className="busted-kicker">BUSTED</p>
        <div className="busted-copy"><p>你的任务已经被识破。</p><p>任务失败，奖励丢失。</p><p>识破者在结算时揭晓。</p></div>
        <div className="busted-actions"><button type="button" onClick={onContinue}>为面子继续</button><button type="button" onClick={onDismiss}>知道了</button></div>
      </div>
    </main>
  );
}
