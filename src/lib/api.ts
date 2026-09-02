export function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("不是执行者") || message.includes("非参与者") || message.includes("不在活动中")) return 403;
  if (message.includes("busted 的任务不能投票") || message.includes("任务已被识破")) return 409;
  if (message.includes("配额已用尽") || message.includes("不能猜自己")) return 400;
  if (message.includes("活动不存在") || message.includes("目标没有已分配的任务")) return 404;
  return 500;
}

/** 未知错误绝不回显，错误信息可能包含任务正文。 */
export function apiError(error: unknown): Response {
  const status = errorStatus(error);
  return Response.json({ error: status === 500 ? "服务器出了点问题" : "请求不能完成" }, { status });
}
