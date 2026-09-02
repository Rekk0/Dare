export interface Participant {
  pid: string;
}

export interface Assignment {
  id: string;
  assigneePid: string;
  authorPid: string;
}

export interface Guess {
  targetPid: string;
  guesserPid: string;
  hit: boolean;
  createdAt: number;
  voided?: boolean;
}

export interface Vote {
  assignmentId: string;
  voterPid: string;
  verdict: 'pass' | 'fail';
}

export interface AiReport {
  assignmentId: string;
  completionScore: number;
}

export interface BountyAward {
  guesserPid: string;
  /** 猜中的是谁。带在这里，省掉结算时按对象身份反查 */
  targetPid: string;
  rank: number;
  shares: number;
}

export interface Settlement {
  assignmentId: string;
  outcome: 'busted' | 'passed' | 'failed';
  toAssignee: number;
  toGuessers: number;
  forfeited: number;
  passRatio?: number;
  voteCount?: number;
  fallbackByAi: boolean;
}

export interface Payout {
  participantId: string;
  taskShares: number;
  bountyShares: number;
  totalShares: number;
  busted: boolean;
  hitTargetPids: string[];
}

export interface SettleInput {
  participants: Participant[];
  assignments: Assignment[];
  guesses: Guess[];
  votes: Vote[];
  aiReports?: AiReport[];
  bountyTiers?: number[];
  votePassRatio?: number;
}

export interface SettleResult {
  settlements: Settlement[];
  payouts: Payout[];
}
