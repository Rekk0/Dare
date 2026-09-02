export type Rng = () => number;

/** 生成严格一一对应且无人拿到自己任务的错位排列。 */
export function assign(participantCount: number, rng: Rng = Math.random): number[] {
  if (participantCount < 3) {
    throw new Error('参与者至少需要 3 人');
  }

  for (;;) {
    const permutation = Array.from({ length: participantCount }, (_, index) => index);
    for (let index = participantCount - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(rng() * (index + 1));
      [permutation[index], permutation[swapIndex]] = [
        permutation[swapIndex],
        permutation[index],
      ];
    }

    if (permutation.every((taskIndex, participantIndex) => taskIndex !== participantIndex)) {
      return permutation;
    }
  }
}
