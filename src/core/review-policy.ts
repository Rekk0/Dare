/**
 * 每局自己定的预审标准。
 *
 * 同事团建和死党局的尺度本来就不该一样，所以这几个值交给创建者调，
 * AI 只负责根据场景给个建议值。判定仍然在代码里做，模型只出分。
 */

export const EDGINESS = {
  1: { label: "温和", desc: "适合同事、不太熟的朋友。不涉及身体接触，不碰隐私话题。" },
  2: { label: "常规", desc: "适合朋友局。允许轻度身体互动和轻微尴尬。" },
  3: { label: "大胆", desc: "适合死党局。允许较强的身体互动和更冒犯的内容。" },
} as const;

export type Edginess = keyof typeof EDGINESS;

export interface ReviewPolicy {
  minFeasibility: number;
  minStealth: number;
  minFun: number;
  minVerifiability: number;
  edginess: Edginess;
}

export const DEFAULT_POLICY: ReviewPolicy = {
  minFeasibility: 30,
  minStealth: 20,
  minFun: 20,
  minVerifiability: 20,
  edginess: 2,
};

const RANGE_FIELDS = [
  ["minFeasibility", "可完成度下限"],
  ["minStealth", "隐蔽度下限"],
  ["minFun", "好玩下限"],
  ["minVerifiability", "可留证下限"],
] as const;

/**
 * 校验创建者传来的值，越界就抛。
 *
 * 不能直接 `{...DEFAULT_POLICY, ...p}`：p 里显式带一个 `undefined`
 * 会把默认值覆盖掉（`{a:1}` 展开 `{a:undefined}` 得到的是 `{a:undefined}`，
 * 不是 `{a:1}`），结果没传这几个字段的请求反而被判成非法。用 ?? 逐个兜底。
 */
export function validatePolicy(p: Partial<ReviewPolicy>): ReviewPolicy {
  const policy: ReviewPolicy = {
    minFeasibility: p.minFeasibility ?? DEFAULT_POLICY.minFeasibility,
    minStealth: p.minStealth ?? DEFAULT_POLICY.minStealth,
    minFun: p.minFun ?? DEFAULT_POLICY.minFun,
    minVerifiability: p.minVerifiability ?? DEFAULT_POLICY.minVerifiability,
    edginess: p.edginess ?? DEFAULT_POLICY.edginess,
  };

  for (const [key, label] of RANGE_FIELDS) {
    const value = policy[key];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error(`${label}必须是 0 到 100 的整数`);
    }
  }
  if (!(policy.edginess in EDGINESS)) throw new Error("尺度只能选温和、常规或大胆");

  return policy;
}
