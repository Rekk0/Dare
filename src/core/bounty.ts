import type { BountyAward, Guess } from './types';

export const DEFAULT_BOUNTY_TIERS = [0.5, 0.3, 0.2] as const;
export const MILLI_SHARE = 1000;

export function bountyTiersToMilliShares(bountyTiers: readonly number[] = DEFAULT_BOUNTY_TIERS): number[] {
  if (bountyTiers.some((tier) => tier < 0) || bountyTiers.reduce((sum, tier) => sum + tier, 0) > 1) {
    throw new Error('赏金份额之和不能超过 1');
  }
  const tiers = bountyTiers.map((tier) => Math.round(tier * MILLI_SHARE));
  if (tiers.reduce((sum, tier) => sum + tier, 0) > MILLI_SHARE) {
    throw new Error('赏金份额之和不能超过 1');
  }
  return tiers;
}

/**
 * 判断一次命中是否作废。作废的命中不占名次、不计赏金、不触发 busted。
 *
 * 两种作废，堵的是两个不同的洞：
 *
 * 1. 出题人猜中自己出的题（`guesserPid === targetAuthorPid`）。
 *    他知道题目原文，不堵这个洞他可以对每个人猜一遍来定点搞死人，
 *    自己一分不拿但纯粹搞死一个人。
 *
 * 2. 执行者猜自己领的任务（`guesserPid === targetPid`）。
 *    他当然知道自己的任务。如果他知道自己完不成、公投必然过不了（拿 0 份），
 *    就可以去猜自己把自己搞成 busted，然后以第一名领 0.5 份 —— 把 0 变成 0.5。
 *    这是真能套利的，必须堵。
 */
export function isVoidedHit(guess: Guess, targetAuthorPid: string): boolean {
  if (guess.voided) return true;
  if (guess.guesserPid === targetAuthorPid) return true;
  if (guess.guesserPid === guess.targetPid) return true;
  return false;
}

/** 先排除作废命中，再按命中时间计算名次和赏金。 */
export function calculateBounties(
  targetAuthorPid: string,
  guesses: readonly Guess[],
  bountyTiers: readonly number[] = DEFAULT_BOUNTY_TIERS,
): BountyAward[] {
  const tiers = bountyTiersToMilliShares(bountyTiers);
  const validHits = guesses
    .filter((guess) => guess.hit && !isVoidedHit(guess, targetAuthorPid))
    .sort((left, right) => left.createdAt - right.createdAt);

  return validHits.map((guess, index) => ({
    guesserPid: guess.guesserPid,
    targetPid: guess.targetPid,
    rank: index + 1,
    shares: (tiers[index] ?? 0) / MILLI_SHARE,
  }));
}
