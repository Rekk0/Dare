import { count, eq } from "drizzle-orm";
import { buildStorageKey, checkUpload, SIGNED_URL_TTL_MS } from "@/core/upload-policy";
import { LocalStorage } from "@/storage/local";
import { apiError } from "@/lib/api";
import { assignmentFacts, evidences } from "@/lib/routes";
import { db } from "@/lib/db";
import { requireParticipant } from "@/lib/session";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const assignmentId = (await params).id; const fact = await assignmentFacts(assignmentId); if (!fact) throw new Error("活动不存在"); const { pid } = await requireParticipant(fact.activityId); const body = await request.json(); const existing = (await (await db).select({ value: count() }).from(evidences).where(eq(evidences.assignmentId, assignmentId)))[0]?.value ?? 0; const checked = checkUpload({ mime: body.mime, bytes: body.bytes, requesterPid: pid, assigneePid: fact.assigneePid, activityStatus: fact.status as "running", existingEvidenceCount: existing }); if (!checked.ok) throw new Error(checked.denial.reason === "not_assignee" ? "不是执行者" : "参数无效"); const signed = await new LocalStorage().signUpload(buildStorageKey(body.mime), body.mime, SIGNED_URL_TTL_MS); return Response.json(signed); } catch (error) { return apiError(error); } }
