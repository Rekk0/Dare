export function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("不是执行者") || message.includes("非参与者") || message.includes("不在活动中")) return 403;
  if (message.includes("busted 的任务不能投票") || message.includes("任务已被识破")) return 409;
  if (message.includes("配额已用尽") || message.includes("不能猜自己")) return 400;
  if (message.includes("活动不存在") || message.includes("目标没有已分配的任务")) return 404;
  return 500;
}

/**
 * 未知错误绝不回显给客户端：错误信息里可能夹着任务正文。
 *
 * 但**必须往服务端日志写**。第一版只吞不记，结果线上 500 之后
 * 服务器日志里一片空白，完全没法查 - 冒烟测试时就是这么卡住的。
 * 「不泄露给客户端」和「不记录」是两回事。
 */
export function apiError(error: unknown): Response {
  const status = errorStatus(error);
  if (status === 500) {
    console.error("[api] 未预期的错误:", error);
  }
  return Response.json(
    { error: status === 500 ? "服务器出了点问题" : "请求不能完成" },
    { status },
  );
}
