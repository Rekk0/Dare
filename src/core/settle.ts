import { bountyTiersToMilliShares, calculateBounties, DEFAULT_BOUNTY_TIERS, MILLI_SHARE } from './bounty';
import type { Payout, SettleInput, SettleResult, Settlement } from './types';

export function settle(input: SettleInput): SettleResult {
  const bountyTiers = input.bountyTiers ?? DEFAULT_BOUNTY_TIERS;
  bountyTiersToMilliShares(bountyTiers);
  const votePassRatio = input.votePassRatio ?? 0.5;
  const reportByAssignmentId = new Map(
    (input.aiReports ?? []).map((report) => [report.assignmentId, report]),
  );
  const awardsByAssigneePid = new Map<string, ReturnType<typeof calculateBounties>>();

  const settlements = input.assignments.map((assignment): Settlement => {
    const awards = calculateBounties(
      assignment.authorPid,
      input.guesses.filter((guess) => guess.targetPid === assignment.assigneePid),
      bountyTiers,
    );
    awardsByAssigneePid.set(assignment.assigneePid, awards);

    // 全部内部结算使用 milli-share，避免 IEEE754 的 0.5 + 0.3 + 0.2 误差。
    const bountyMilli = awards.reduce((sum, award) => sum + Math.round(award.shares * MILLI_SHARE), 0);
    if (awards.length > 0) {
      return {
        assignmentId: assignment.id,
        outcome: 'busted',
        toAssignee: 0,
        toGuessers: bountyMilli / MILLI_SHARE,
        forfeited: (MILLI_SHARE - bountyMilli) / MILLI_SHARE,
        fallbackByAi: false,
      };
    }

    const validVotes = input.votes.filter(
      (vote) => vote.assignmentId === assignment.id && vote.voterPid !== assignment.assigneePid,
    );
    const passVotes = validVotes.filter((vote) => vote.verdict === 'pass').length;
    const quorum = Math.ceil((input.participants.length - 1) / 2);
    // 零票时必须走 AI 兜底，否则下面是 0/0 = NaN。
    // quorum 在人数退化到 1 时会算成 0，所以不能只靠 validVotes.length < quorum。
    const fallbackByAi = validVotes.length === 0 || validVotes.length < quorum;
    const passed = fallbackByAi
      ? (reportByAssignmentId.get(assignment.id)?.completionScore ?? 0) >= 60
      : passVotes / validVotes.length > votePassRatio;

    return {
      assignmentId: assignment.id,
      outcome: passed ? 'passed' : 'failed',
      toAssignee: passed ? 1 : 0,
      toGuessers: 0,
      forfeited: passed ? 0 : 1,
      passRatio: validVotes.length === 0 ? 0 : passVotes / validVotes.length,
      voteCount: validVotes.length,
      fallbackByAi,
    };
  });

  const settlementByAssignmentId = new Map(settlements.map((settlement) => [settlement.assignmentId, settlement]));
  const assignmentByAssigneePid = new Map(input.assignments.map((assignment) => [assignment.assigneePid, assignment]));
  const payouts = input.participants.map((participant): Payout => {
    const assignment = assignmentByAssigneePid.get(participant.pid);
    const settlement = assignment ? settlementByAssignmentId.get(assignment.id) : undefined;
    const bountyAwards = [...awardsByAssigneePid.values()].flat().filter((award) => award.guesserPid === participant.pid);
    const bountyMilli = bountyAwards.reduce((sum, award) => sum + Math.round(award.shares * MILLI_SHARE), 0);

    return {
      participantId: participant.pid,
      taskShares: settlement?.toAssignee ?? 0,
      bountyShares: bountyMilli / MILLI_SHARE,
      totalShares: (settlement?.toAssignee ?? 0) + bountyMilli / MILLI_SHARE,
      busted: settlement?.outcome === 'busted',
      hitTargetPids: bountyAwards.map((award) => award.targetPid),
    };
  });

  return { settlements, payouts };
}
