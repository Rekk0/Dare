import { castVote } from "@/db/queries/votes";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { assignmentFacts } from "@/lib/routes";
import { requireParticipant } from "@/lib/session";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const assignmentId = (await params).id; const fact = await assignmentFacts(assignmentId); if (!fact) throw new Error("活动不存在"); const { pid } = await requireParticipant(fact.activityId); const body = await request.json(); await castVote(await db, { assignmentId, voterPid: pid, verdict: body.verdict, score: body.score, comment: body.comment }); return Response.json({ ok: true }); } catch (error) { return apiError(error); } }
