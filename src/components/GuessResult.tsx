import type { GuessResultDto } from "@/core/visibility";

/**
 * 猜测结果全屏。
 *
 * **必须给出路。** 第一版只有一个大字，猜错了之后整屏没有任何可点的东西，
 * 只能靠浏览器后退 - 而后退回去的是提交过的表单，体验上像卡死了。
 */
export default function GuessResult({
  outcome,
  quotaLeft,
  quotaTotal,
  rank,
  bountyShares,
  activityId,
  onAgain,
}: GuessResultDto & { activityId?: string; onAgain?: () => void }) {
  const copy = outcome === "hit" ? "成功识破！" : outcome === "close" ? "已经接近了" : "不是这个";
  return (
    <section className={`guess-result guess-result--${outcome}`} aria-live="polite">
      <style>{`
        .guess-result { position: relative; min-height: 100dvh; overflow: hidden; padding: 24px; background: var(--ground); color: var(--bright); }.guess-result__quota { margin: 0; font-size: 14px; color: var(--dim); }.guess-result__quota strong { color: var(--bright); }.guess-result__body { display: grid; min-height: calc(100dvh - 48px); place-content: center; text-align: center; }.guess-result h2 { margin: 0; font-family: var(--font-display); font-size: clamp(48px, 16vw, 80px); }.guess-result__detail { margin: 20px 0 0; font-size: 17px; color: var(--body); }.guess-result--hit::after { content: ""; position: absolute; inset: 0; background: var(--mark); opacity: 0; animation: guess-hit-flash 300ms ease-out; pointer-events: none; }.guess-result--hit h2 { color: var(--mark); }.guess-result--close .guess-result__body { outline: 2px solid color-mix(in srgb, var(--mark) 72%, var(--alarm)); outline-offset: -14px; animation: guess-close-pulse 500ms ease-out; }.guess-result--close h2 { color: color-mix(in srgb, var(--mark) 72%, var(--alarm)); }.guess-result--cold h2 { color: var(--dim); }.guess-result__exits { display: grid; gap: 12px; margin: 36px auto 0; max-width: 260px; }.guess-result__again, .guess-result__back { display: flex; align-items: center; justify-content: center; min-height: 48px; border-radius: 999px; font-size: 15px; font-weight: 700; text-decoration: none; }.guess-result__again { background: var(--mark); color: var(--ground); border: 0; }.guess-result__back { border: 1px solid var(--line); color: var(--bright); }@keyframes guess-hit-flash { 0% { opacity: .9; } 100% { opacity: 0; } } @keyframes guess-close-pulse { 0%, 100% { outline-color: color-mix(in srgb, var(--mark) 72%, var(--alarm)); } 50% { outline-color: transparent; } }
      `}</style>
      <p className="guess-result__quota">剩余猜测次数 <strong className="tabular-nums">{quotaLeft} / {quotaTotal}</strong></p>
      <div className="guess-result__body">
        <div>
          <h2>{copy}</h2>
          {outcome === "hit" ? (
            <>
              <p className="guess-result__detail">你是第 {rank ?? "-"} 个</p>
              <p className="guess-result__detail">本次赏金份额：{bountyShares ?? 0} 份</p>
            </>
          ) : null}
          <div className="guess-result__exits">
            {onAgain && quotaLeft > 0 ? (
              <button type="button" onClick={onAgain} className="guess-result__again">再猜一个</button>
            ) : null}
            {activityId ? (
              <a href={`/a/${activityId}`} className="guess-result__back">返回活动页</a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
