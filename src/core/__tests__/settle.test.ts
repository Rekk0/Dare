import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { settle } from '../settle';
import type { Assignment, Participant, SettleInput } from '../types';

const participants: Participant[] = ['a', 'b', 'c', 'd'].map((pid) => ({ pid }));
const assignments: Assignment[] = [
  { id: 'a1', assigneePid: 'a', authorPid: 'b' },
  { id: 'a2', assigneePid: 'b', authorPid: 'c' },
  { id: 'a3', assigneePid: 'c', authorPid: 'd' },
  { id: 'a4', assigneePid: 'd', authorPid: 'a' },
];

function run(guesses: SettleInput['guesses'], votes: SettleInput['votes'], score = 0) {
  return settle({ participants, assignments, guesses, votes, aiReports: [{ assignmentId: 'a1', completionScore: score }] });
}

describe('settle', () => {
  it('无人猜中且公投通过时执行者拿满一份', () => {
    const result = run([], [{ assignmentId: 'a1', voterPid: 'b', verdict: 'pass' }, { assignmentId: 'a1', voterPid: 'c', verdict: 'pass' }]);
    expect(result.settlements[0]).toMatchObject({ outcome: 'passed', toAssignee: 1, toGuessers: 0, forfeited: 0 });
  });

  it('无人猜中且公投未通过时整份作废', () => {
    const result = run([], [{ assignmentId: 'a1', voterPid: 'b', verdict: 'pass' }, { assignmentId: 'a1', voterPid: 'c', verdict: 'fail' }]);
    expect(result.settlements[0]).toMatchObject({ outcome: 'failed', toAssignee: 0, toGuessers: 0, forfeited: 1 });
  });

  it('一人命中时其余赏金作废', () => {
    const result = run([{ targetPid: 'a', guesserPid: 'c', hit: true, createdAt: 1 }], []);
    expect(result.settlements[0]).toMatchObject({ outcome: 'busted', toGuessers: 0.5, forfeited: 0.5 });
  });

  it('两人命中时第三档作废', () => {
    const result = run([
      { targetPid: 'a', guesserPid: 'c', hit: true, createdAt: 1 },
      { targetPid: 'a', guesserPid: 'd', hit: true, createdAt: 2 },
    ], []);
    expect(result.settlements[0]).toMatchObject({ outcome: 'busted', toGuessers: 0.8, forfeited: 0.2 });
  });

  it('三人及以上命中时只支付前三档', () => {
    const result = run([
      { targetPid: 'a', guesserPid: 'c', hit: true, createdAt: 1 },
      { targetPid: 'a', guesserPid: 'd', hit: true, createdAt: 2 },
      { targetPid: 'a', guesserPid: 'e', hit: true, createdAt: 3 },
      { targetPid: 'a', guesserPid: 'f', hit: true, createdAt: 4 },
    ], []);
    expect(result.settlements[0]).toMatchObject({ outcome: 'busted', toGuessers: 1, forfeited: 0 });
  });

  it('property: 10000 cases preserve I1 and I2', () => {
    let cases = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 12 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 144 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 144 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 144 }),
        (count, hitBits, passBits, voidBits) => {
          const generatedParticipants = Array.from({ length: count }, (_, index) => ({ pid: `p${index}` }));
          const generatedAssignments = generatedParticipants.map((participant, index) => ({
            id: `a${index}`,
            assigneePid: participant.pid,
            authorPid: generatedParticipants[(index + 1) % count].pid,
          }));
          const guesses = hitBits.map((hit, index) => ({
            targetPid: `p${index % count}`,
            guesserPid: `p${(index * 3 + 1) % count}`,
            hit,
            voided: voidBits[index] ?? false,
            createdAt: index,
          }));
          const votes = passBits.map((pass, index) => ({
            assignmentId: `a${index % count}`,
            voterPid: `p${(index * 5 + 1) % count}`,
            verdict: pass ? 'pass' as const : 'fail' as const,
          }));
          const result = settle({
            participants: generatedParticipants,
            assignments: generatedAssignments,
            guesses,
            votes,
            aiReports: generatedAssignments.map((assignment, index) => ({ assignmentId: assignment.id, completionScore: index % 2 === 0 ? 60 : 59 })),
          });
          cases += 1;
          expect(result.settlements.every((item) =>
            Math.round((item.toAssignee + item.toGuessers + item.forfeited) * 1000) === 1000,
          )).toBe(true);
          expect(
            result.payouts.reduce((sum, item) => sum + Math.round(item.totalShares * 1000), 0) +
              result.settlements.reduce((sum, item) => sum + Math.round(item.forfeited * 1000), 0),
          ).toBe(count * 1000);
        },
      ),
      { numRuns: 10_000 },
    );
    console.log(`property test executed ${cases} cases`);
    expect(cases).toBe(10_000);
  });
});

describe('settle 作废命中', () => {
  it('执行者猜自己领的任务：不触发 busted，不拿赏金', () => {
    // 套利场景：a 知道自己完不成（公投必然不过，拿 0 份），
    // 于是去猜自己，想把自己搞成 busted 再以第一名领 0.5 份。必须拿不到。
    const result = run(
      [{ targetPid: 'a', guesserPid: 'a', hit: true, createdAt: 1 }],
      [
        { assignmentId: 'a1', voterPid: 'b', verdict: 'fail' },
        { assignmentId: 'a1', voterPid: 'c', verdict: 'fail' },
      ],
    );
    expect(result.settlements[0]).toMatchObject({
      outcome: 'failed',
      toAssignee: 0,
      toGuessers: 0,
      forfeited: 1,
    });
    const a = result.payouts.find((p) => p.participantId === 'a');
    expect(a).toMatchObject({ taskShares: 0, bountyShares: 0, totalShares: 0, busted: false });
  });

  it('出题人猜中自己出的题：不触发 busted，不占名次', () => {
    // a1 由 b 出题、a 执行。b 猜中 a 应当作废，
    // 且不能占掉第一名的位置 —— c 才是第一名，拿 0.5 不是 0.3。
    const result = run(
      [
        { targetPid: 'a', guesserPid: 'b', hit: true, createdAt: 1 },
        { targetPid: 'a', guesserPid: 'c', hit: true, createdAt: 2 },
      ],
      [],
    );
    expect(result.settlements[0]).toMatchObject({ outcome: 'busted', toGuessers: 0.5, forfeited: 0.5 });
    expect(result.payouts.find((p) => p.participantId === 'b')?.bountyShares).toBe(0);
    expect(result.payouts.find((p) => p.participantId === 'c')?.bountyShares).toBe(0.5);
  });

  it('全部命中都作废时不算 busted，照常走公投', () => {
    const result = run(
      [
        { targetPid: 'a', guesserPid: 'a', hit: true, createdAt: 1 },
        { targetPid: 'a', guesserPid: 'b', hit: true, createdAt: 2 },
      ],
      [
        { assignmentId: 'a1', voterPid: 'b', verdict: 'pass' },
        { assignmentId: 'a1', voterPid: 'c', verdict: 'pass' },
      ],
    );
    expect(result.settlements[0]).toMatchObject({ outcome: 'passed', toAssignee: 1, forfeited: 0 });
  });

  it('hitTargetPids 记录猜中了谁', () => {
    const result = run(
      [
        { targetPid: 'a', guesserPid: 'c', hit: true, createdAt: 1 },
        { targetPid: 'd', guesserPid: 'c', hit: true, createdAt: 2 },
      ],
      [],
    );
    const c = result.payouts.find((p) => p.participantId === 'c');
    expect(c?.hitTargetPids.sort()).toEqual(['a', 'd']);
    expect(c?.bountyShares).toBe(1);
  });
});

describe('settle 旁观者', () => {
  it('没出题的人不占奖池，守恒按任务数而非人数', () => {
    // project-design.md §4：到 start_at 还没出题的人移出分配，
    // 但仍可投票和猜。此时人数 > 任务数，守恒的分母是任务数。
    const withSpectator: Participant[] = [...participants, { pid: 'spec' }];
    const result = settle({
      participants: withSpectator,
      assignments,
      guesses: [{ targetPid: 'a', guesserPid: 'spec', hit: true, createdAt: 1 }],
      votes: [],
      aiReports: assignments.map((x) => ({ assignmentId: x.id, completionScore: 0 })),
    });

    const spec = result.payouts.find((p) => p.participantId === 'spec');
    expect(spec).toMatchObject({ taskShares: 0, bountyShares: 0.5, busted: false });

    const paid = result.payouts.reduce((s, p) => s + Math.round(p.totalShares * 1000), 0);
    const forfeited = result.settlements.reduce((s, x) => s + Math.round(x.forfeited * 1000), 0);
    expect(paid + forfeited).toBe(assignments.length * 1000);
  });
});
