/**
 * 在线兜底的消息上下文装配（追问面板与智能助理共用，08 修订案 A12）。
 *
 * 从追问面板抽取的纯函数与常量：历史消息预算裁剪、在线接口口径常量。
 * 预算裁剪规则与 /api/followup 的参数校验同口径：单条 ≤4000 字、总长 ≤8000 字、
 * 最多 20 条——客户端按更紧的预算（扣除上下文后）从最新一条往回装，超了就停。
 */

/** 在线接口的消息总长上限（与 /api/followup 的参数校验同口径） */
export const MESSAGE_BUDGET = 8000;

/** 在线接口的单条消息长度上限（与 /api/followup 的参数校验同口径） */
export const MESSAGE_MAX_LENGTH = 4000;

/** 在线兜底携带的最近对话轮数上限 */
export const HISTORY_TURNS = 10;

/** 在线兜底时夹在对话开头的账单数据说明（汇总统计 + 最近明细快照，08 修订案 A8） */
export const ONLINE_CONTEXT_PREFIX = "以下是我的账单数据（汇总统计与最近明细）：\n";

/** 深度分析（A14）的全期统计消息前缀：与明细消息分开两条发送，各自语义完整 */
export const DEEP_CONTEXT_PREFIX = "以下是我的账单全期统计（深度分析）：\n";

/** 深度分析（A15）的定向明细消息前缀：按问题识别的月份/商户/类目/深夜条件查出的相关明细 */
export const TARGETED_CONTEXT_PREFIX = "以下是账单中与问题直接相关的明细：\n";

/** 深度分析（A14）的明细快照消息前缀（与普通兜底共用 A8 明细口径） */
export const DETAIL_CONTEXT_PREFIX = "以下是我的账单最近明细：\n";

/** 在线消息：与 /api/followup 请求体 messages 元素同形 */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * 最近对话映射为在线消息数组：本轮用户问题恒在末尾（用户刚输入的内容
 * 不能被预算裁掉），历史气泡按剩余预算从最新一条往回装，超了就停。
 * 空消息与超过单条 4000 字上限的消息（如深度分析的长回答）先整体剔除、
 * 再取最近 HISTORY_TURNS 轮——先过滤后截取，避免十条超长消息把真正
 * 最近的合法历史挤出窗口；否则超长条会把整次请求拖进 /api/followup
 * 的单条校验 400。本轮问题不受单条上限约束。
 * 预算装不下任何历史时只保留本轮问题。
 */
export function buildHistoryMessages(
  turns: Array<{ role: "user" | "assistant"; text: string }>,
  currentText: string,
  budget: number,
): HistoryMessage[] {
  const mapped = turns
    .map((turn) => ({ role: turn.role, content: turn.text }))
    .filter(
      (message) =>
        message.content.length > 0 && message.content.length <= MESSAGE_MAX_LENGTH,
    )
    .slice(-HISTORY_TURNS);
  const kept: HistoryMessage[] = [];
  let used = 0;
  for (let i = mapped.length - 1; i >= 0; i -= 1) {
    const message = mapped[i];
    if (!message) continue;
    if (used + message.content.length > budget) break;
    kept.push(message);
    used += message.content.length;
  }
  return [...kept.reverse(), { role: "user", content: currentText }];
}

/** 在线消息里的案例参考段上限（字）：先于明细快照预算扣除，防止案例摘要挤占账单数据空间 */
export const CASE_REFS_MAX_LENGTH = 600;

/** 案例参考单条摘要上限（字） */
export const CASE_SNIPPET_MAX_LENGTH = 120;

/** 明细快照预算过小时省略该段（低于此值快照只剩两三行，不如不带） */
export const DETAIL_MIN_LENGTH = 600;

/**
 * 明细快照预算：总预算 8000 先扣除统计段 / 定向段 / 案例参考段 / 前缀 /
 * 本轮问题，剩余全部给明细快照；同时受单条 4000 上限约束——
 * deep 档三段分三条消息，快照独占一条；日常档统计与明细合并一条消息，
 * 快照还要给统计段让出单条空间（合计 ≤3900 字）。
 * 历史对话不在此预留：由装配方按「8000 - 已用 - 本轮问题长」动态给出
 * 真实剩余预算（buildHistoryMessages 只装得进多少算多少）。
 * 返回负数表示没有快照空间，调用方应省略快照段（气泡脚注按实际发送标注）。
 */
export function computeDetailBudget(params: {
  deep: boolean;
  context: string;
  targeted: string;
  refs: string;
  question: string;
}): number {
  const prefixes = params.deep
    ? DEEP_CONTEXT_PREFIX.length + TARGETED_CONTEXT_PREFIX.length + DETAIL_CONTEXT_PREFIX.length
    : ONLINE_CONTEXT_PREFIX.length;
  const fixed =
    params.context.length +
    params.targeted.length +
    params.refs.length +
    prefixes +
    params.question.length;
  const perMessageBudget = params.deep
    ? MESSAGE_MAX_LENGTH - 100
    : MESSAGE_MAX_LENGTH - 100 - params.context.length;
  return Math.min(perMessageBudget, MESSAGE_BUDGET - fixed);
}

/**
 * 案例参考段文本：每条摘要截断到 CASE_SNIPPET_MAX_LENGTH，整段再压
 * CASE_REFS_MAX_LENGTH——参考段是锦上添花，不能挤占账单数据的预算。
 * 截断按码点（Array.from）而非 UTF-16 码元，避免把代理对（emoji 等）
 * 从中间切开产生乱码；整段含省略号仍 ≤CASE_REFS_MAX_LENGTH。
 */
export function buildCaseRefsText(
  cases: ReadonlyArray<{ title: string; snippet: string }>,
): string {
  const refs = cases.map((item) => {
    const points = Array.from(item.snippet);
    const snippet =
      points.length > CASE_SNIPPET_MAX_LENGTH
        ? `${points.slice(0, CASE_SNIPPET_MAX_LENGTH).join("")}…`
        : item.snippet;
    return `案例参考（${item.title}：${snippet}）`;
  });
  const text = refs.join("\n");
  const textPoints = Array.from(text);
  return textPoints.length > CASE_REFS_MAX_LENGTH
    ? `${textPoints.slice(0, CASE_REFS_MAX_LENGTH - 1).join("")}…`
    : text;
}
