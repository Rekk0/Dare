import type { GuessResultDto } from "@/core/visibility";

export default function GuessResult({ outcome, quotaLeft, rank, bountyShares }: GuessResultDto) {
  const copy = outcome === "hit" ? "猜中了" : outcome === "close" ? "很接近" : "不是这个";
  return (
    <section className={`guess-result guess-result--${outcome}`} aria-live="polite">
      <style>{`
        .guess-result { position: relative; min-height: 100dvh; overflow: hidden; padding: 24px; background: var(--ground); color: var(--bright); }.guess-result__quota { margin: 0; font-size: 14px; color: var(--dim); }.guess-result__quota strong { color: var(--bright); }.guess-result__body { display: grid; min-height: calc(100dvh - 48px); place-content: center; text-align: center; }.guess-result h2 { margin: 0; font-family: var(--font-display); font-size: clamp(48px, 16vw, 80px); }.guess-result__detail { margin: 20px 0 0; font-size: 17px; color: var(--body); }.guess-result--hit::after { content: ""; position: absolute; inset: 0; background: var(--mark); opacity: 0; animation: guess-hit-flash 300ms ease-out; pointer-events: none; }.guess-result--hit h2 { color: var(--mark); }.guess-result--close .guess-result__body { outline: 2px solid color-mix(in srgb, var(--mark) 72%, var(--alarm)); outline-offset: -14px; animation: guess-close-pulse 500ms ease-out; }.guess-result--close h2 { color: color-mix(in srgb, var(--mark) 72%, var(--alarm)); }.guess-result--cold h2 { color: var(--dim); }@keyframes guess-hit-flash { 0% { opacity: .9; } 100% { opacity: 0; } } @keyframes guess-close-pulse { 0%, 100% { outline-color: color-mix(in srgb, var(--mark) 72%, var(--alarm)); } 50% { outline-color: transparent; } }
      `}</style>
      <p className="guess-result__quota">剩余配额 <strong className="tabular-nums">{quotaLeft} / 3</strong></p>
      <div className="guess-result__body"><div><h2>{copy}</h2>{outcome === "hit" ? <><p className="guess-result__detail">你是第 {rank ?? "-"} 个</p><p className="guess-result__detail">本次赏金份额：{bountyShares ?? 0} 份</p></> : null}</div></div>
    </section>
  );
}
