/**
 * AI 在跑的时候给个动静。
 *
 * 预审、猜测判定都要打一次厂商 API，实测 2 到 5 秒。这几秒里如果界面
 * 一动不动，用户会以为按钮没点着，然后反复点 -- 既多花钱又可能重复提交。
 * 所以等待期间必须有可见反馈，按钮也必须禁掉。
 *
 * 用涂黑条的脉冲，跟整个应用的防窥视觉是一套东西，不另外引进转圈图标。
 */
export default function AiThinking({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-3 w-6 animate-pulse rounded-[2px] bg-mark"
            style={{ animationDelay: `${i * 160}ms`, animationDuration: "1.1s" }}
          />
        ))}
      </span>
      <span className="text-[13px] text-dim">{label}</span>
    </div>
  );
}
