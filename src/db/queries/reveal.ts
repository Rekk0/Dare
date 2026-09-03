import { and, eq } from "drizzle-orm";
import {
  projectReveal,
  type ActivityStatus,
  type EvidenceDto,
  type PublicAiReportDto,
  type RevealAssignmentDto,
} from "@/core/visibility";
import { LocalStorage } from "@/storage/local";
import type { Db } from "../client";
import { activities, aiReports, assignments, evidences, guesses, tasks } from "../schema";

export interface RevealData {
  assignments: RevealAssignmentDto[];
}

const REVEAL_SIGNED_URL_TTL_MS = 30 * 60 * 1000;

function publicAiReport(report: unknown): PublicAiReportDto | null {
  if (!report || typeof report !== "object") return null;
  const value = report as { summary?: unknown; verdict?: unknown };
  if (typeof value.summary !== "string") return null;
  return typeof value.verdict === "string"
    ? { verdict: value.verdict, summary: value.summary }
    : { summary: value.summary };
}

/** 每条揭晓记录都通过 projectReveal 裁剪，不能在这里复制保密规则。 */
export async function getReveal(db: Db, activityId: string, viewerPid: string): Promise<RevealData> {
  const rows = await db
    .select({
      status: activities.status,
      assignmentId: assignments.id,
      assigneePid: assignments.assigneePid,
      authorPid: tasks.authorPid,
      taskContent: tasks.content,
      assignmentStatus: assignments.status,
      bustedByPid: guesses.guesserPid,
      evidenceId: evidences.id,
      evidenceKind: evidences.kind,
      evidenceStorageKey: evidences.storageKey,
      evidenceMime: evidences.mime,
      report: aiReports.report,
    })
    .from(assignments)
    .innerJoin(activities, eq(assignments.activityId, activities.id))
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .leftJoin(guesses, and(eq(guesses.targetPid, assignments.assigneePid), eq(guesses.rank, 1)))
    .leftJoin(evidences, eq(evidences.assignmentId, assignments.id))
    .leftJoin(aiReports, eq(aiReports.assignmentId, assignments.id))
    .where(eq(assignments.activityId, activityId));

  const storage = new LocalStorage();
  const grouped = new Map<string, {
    status: ActivityStatus;
    assignmentId: string;
    assigneePid: string;
    authorPid: string;
    taskContent: string;
    assignmentStatus: string;
    bustedByPid: string | null;
    evidence: EvidenceDto[];
    aiReport: PublicAiReportDto | null;
  }>();

  for (const row of rows) {
    let assignment = grouped.get(row.assignmentId);
    if (!assignment) {
      assignment = {
        status: row.status as ActivityStatus,
        assignmentId: row.assignmentId,
        assigneePid: row.assigneePid,
        authorPid: row.authorPid,
        taskContent: row.taskContent,
        assignmentStatus: row.assignmentStatus,
        bustedByPid: row.bustedByPid,
        evidence: [],
        aiReport: publicAiReport(row.report),
      };
      grouped.set(row.assignmentId, assignment);
    }
    if (row.evidenceId && row.evidenceKind && row.evidenceStorageKey && row.evidenceMime) {
      assignment.evidence.push({
        id: row.evidenceId,
        kind: row.evidenceKind as EvidenceDto["kind"],
        url: await storage.signDownload(row.evidenceStorageKey, REVEAL_SIGNED_URL_TTL_MS),
        mime: row.evidenceMime,
      });
    }
  }

  return {
    assignments: [...grouped.values()].map((row) => projectReveal(
      { pid: viewerPid, status: row.status },
      {
        assignmentId: row.assignmentId,
        assigneePid: row.assigneePid,
        authorPid: row.authorPid,
        taskContent: row.taskContent,
        busted: row.assignmentStatus === "busted",
        bustedByPid: row.bustedByPid,
        evidence: row.evidence,
        aiReport: row.aiReport,
      },
    )),
  };
}
