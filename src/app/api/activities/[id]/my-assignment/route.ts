import { apiError } from "@/lib/api";
import { myAssignment } from "@/lib/routes";
import { requireParticipant } from "@/lib/session";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { const { id } = await params; const { pid } = await requireParticipant(id); return Response.json(await myAssignment(id, pid)); } catch (error) { return apiError(error); } }
