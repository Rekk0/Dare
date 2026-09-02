import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { participants, payouts } from "@/db/schema";
import { requireParticipant } from "@/lib/session";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { const { id } = await params; const { pid } = await requireParticipant(id); const mine = (await (await db).select({ taskShares: payouts.taskShares, bountyShares: payouts.bountyShares, totalShares: payouts.totalShares, busted: payouts.busted }).from(payouts).innerJoin(participants, eq(payouts.participantId, participants.id)).where(eq(participants.id, pid)))[0]; return Response.json(mine ?? null); } catch (error) { return apiError(error); } }
