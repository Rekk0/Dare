import { describe, expect, it } from 'vitest';
import { assign } from '../assign';

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('assign', () => {
  it('在 1000 次固定随机源分配中始终是 derangement', () => {
    const rng = seededRng(42);
    for (let run = 0; run < 1000; run += 1) {
      const assignments = assign(12, rng);
      expect(new Set(assignments).size).toBe(12);
      expect(assignments.every((taskIndex, participantIndex) => taskIndex !== participantIndex)).toBe(true);
    }
  });

  it.each([0, 1, 2])('少于 3 人拒绝分配: %i', (count) => {
    expect(() => assign(count)).toThrow();
  });
});
