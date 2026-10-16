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
 * 最近对话映射为在线消息数组：历史气泡 + 本轮用户问题，取最近若干轮，
 * 从最旧一条开始裁剪，保证消息总长不超过接口预算（预算已扣除上下文长度）。
 * 空消息跳过；历史消息超过单条 4000 字上限（如深度分析的长回答）整条跳过、
 * 继续装更旧的——否则该条会把整次请求拖进 /api/followup 的单条校验 400；
 * 本轮问题不受单条上限约束（用户刚输入的内容不能替用户裁掉）。
 * 预算装不下任何历史时只保留本轮问题。
 */
export function buildHistoryMessages(
  turns: Array<{ role: "user" | "assistant"; text: string }>,
  currentText: string,
  budget: number,
): HistoryMessage[] {
  const current: HistoryMessage = { role: "user", content: currentText };
  const mapped = turns
    .map((turn) => ({ role: turn.role, content: turn.text }))
    .concat([current])
    .slice(-HISTORY_TURNS);
  const kept: HistoryMessage[] = [];
  let used = 0;
  for (let i = mapped.length - 1; i >= 0; i -= 1) {
    const message = mapped[i];
    if (!message || message.content.length === 0) continue;
    if (message !== current && message.content.length > MESSAGE_MAX_LENGTH) continue;
    if (used + message.content.length > budget) break;
    kept.push(message);
    used += message.content.length;
  }
  return kept.reverse();
}
