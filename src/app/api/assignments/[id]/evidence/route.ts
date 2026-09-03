import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { LocalStorage } from "@/storage/local";
import { apiError } from "@/lib/api";
import { assignmentFacts, evidences } from "@/lib/routes";
import { db } from "@/lib/db";
import { requireParticipant } from "@/lib/session";

const EVIDENCE_LIST_SIGNED_URL_TTL_MS = 30 * 60 * 1000;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const assignmentId = (await params).id;
    const fact = await assignmentFacts(assignmentId);
    if (!fact) throw new Error("活动不存在");
    const { pid } = await requireParticipant(fact.activityId);
    if (pid !== fact.assigneePid) throw new Error("不是执行者");

    const storage = new LocalStorage();
    const rows = await (await db)
      .select({ id: evidences.id, kind: evidences.kind, storageKey: evidences.storageKey, mime: evidences.mime })
      .from(evidences)
      .where(eq(evidences.assignmentId, assignmentId));
    return Response.json({
      evidence: await Promise.all(rows.map(async (row) => ({
        id: row.id,
        kind: row.kind,
        mime: row.mime,
        url: await storage.signDownload(row.storageKey, EVIDENCE_LIST_SIGNED_URL_TTL_MS),
      }))),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const assignmentId = (await params).id;
    const fact = await assignmentFacts(assignmentId);
    if (!fact) throw new Error("活动不存在");
    const { pid } = await requireParticipant(fact.activityId);
    if (pid !== fact.assigneePid) throw new Error("不是执行者");
    const body = await request.json();
    await (await db).insert(evidences).values({
      id: nanoid(), assignmentId, kind: body.kind, storageKey: body.key, mime: body.mime, bytes: body.bytes,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
