import { describe, expect, it } from 'vitest';
import { calculateBounties } from '../bounty';

describe('calculateBounties', () => {
  it('作者的命中作废，不占名次也不拿赏金', () => {
    const awards = calculateBounties('author', [
      { targetPid: 'target', guesserPid: 'author', hit: true, createdAt: 1 },
      { targetPid: 'target', guesserPid: 'first', hit: true, createdAt: 2 },
      { targetPid: 'target', guesserPid: 'second', hit: true, createdAt: 3 },
    ]);

    expect(awards).toEqual([
      { guesserPid: 'first', targetPid: 'target', rank: 1, shares: 0.5 },
      { guesserPid: 'second', targetPid: 'target', rank: 2, shares: 0.3 },
    ]);
  });

  it('执行者猜自己领的任务作废，不占名次也不拿赏金', () => {
    const awards = calculateBounties('author', [
      { targetPid: 'target', guesserPid: 'target', hit: true, createdAt: 1 },
      { targetPid: 'target', guesserPid: 'first', hit: true, createdAt: 2 },
    ]);

    expect(awards).toEqual([
      { guesserPid: 'first', targetPid: 'target', rank: 1, shares: 0.5 },
    ]);
  });

  it('第四名及以后记名次但不拿赏金', () => {
    const awards = calculateBounties('author', [1, 2, 3, 4].map((n) => ({
      targetPid: 'target',
      guesserPid: `g${n}`,
      hit: true,
      createdAt: n,
    })));

    expect(awards.map((a) => a.shares)).toEqual([0.5, 0.3, 0.2, 0]);
    expect(awards[3]).toMatchObject({ guesserPid: 'g4', rank: 4 });
  });

  it('拒绝总份额大于一的配置', () => {
    expect(() => calculateBounties('author', [], [0.6, 0.5])).toThrow();
  });
});
