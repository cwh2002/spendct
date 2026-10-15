/**
 * 聊天输入闸门（02 §11 提示注入三层防护的输入侧补强，08 修订案 A12）。
 *
 * 追问面板与智能助理在本地层之前先过这道闸：命中注入特征的输入不进入
 * 意图解析、不转发在线服务，直接回固定拒绝话术——注入企图从入口就被
 * 挡下，而不是指望模型在提示词层面自我约束。
 *
 * 判定只做模式匹配，不做语义理解：宁可把正常问句放行（本地引擎答不了
 * 会自然转在线），也只在特征明确时才拦。全部为纯函数与常量。
 */

/** 闸门判定结果：blocked 为真时 reason 说明命中的特征 */
export interface GuardVerdict {
  blocked: boolean;
  reason?: string;
}

/** 拒绝注入输入时的固定话术（追问面板与智能助理共用） */
export const GUARD_BLOCKED_REPLY =
  "这条消息看起来像要改写我的回答规则，我没有照做。直接问账单问题就行，比如「这个月花了多少」。";

/**
 * 指令覆盖类特征：试图覆盖系统设定或改写回答规则。
 * 全部小写匹配（对外文字符串先 toLowerCase 再查）。
 */
const INSTRUCTION_OVERRIDE_PATTERNS: readonly string[] = [
  "ignore previous",
  "ignore all previous",
  "ignore above",
  "disregard previous",
  "disregard above",
  "forget previous",
  "forget what i said",
  "忽略以上",
  "忽略之前",
  "忽略此前的",
  "无视以上",
  "无视之前的",
  "忘记之前的",
  "忘记以上",
  "system:",
  "system prompt",
  "系统提示",
  "系统指令",
  "开发者指令",
  "debug:",
  "你是我的开发者",
  "你被要求",
];

/** 角色劫持类特征：让助手扮演另一角色或模拟另一个系统 */
const ROLE_HIJACK_PATTERNS: readonly string[] = [
  "你现在是",
  "从现在开始你是",
  "假装你是",
  "扮演",
  "角色扮演",
  "act as",
  "pretend you are",
  "you are now",
];

/** 规则泄露诱导类特征：套取提示词原文 */
const LEAK_PROBE_PATTERNS: readonly string[] = [
  "你的提示词",
  "你的prompt",
  "你的系统指令",
  "你的设定",
  "your prompt",
  "your instructions",
  "your system",
  "repeat the words above",
  "把上面的话重复",
  "复述上面的",
];

/** SQL 注入类特征：聊天输入里出现 SQL 语句痕迹（聊天不执行 SQL，直接拦） */
const SQL_INJECTION_PATTERNS: readonly string[] = [
  "select ",
  "drop table",
  "union select",
  "delete from",
  "insert into",
  "update transactions",
  "--",
  "/*",
  "*/",
];

/** 单条输入长度上限：与 /api/followup 的 question 上限同口径，超长一律拦 */
export const INPUT_MAX_LENGTH = 500;

/**
 * 闸门主入口：返回放行或拦截判定。
 * 判定顺序：控制字符 → 超长 → 指令覆盖 → 角色劫持 → 泄露诱导 → SQL 痕迹。
 */
export function checkChatInput(text: string): GuardVerdict {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { blocked: false };

  // 控制字符（换行/制表等排版字符除外）：正常输入不该出现
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(trimmed)) {
    return { blocked: true, reason: "control-characters" };
  }

  if (trimmed.length > INPUT_MAX_LENGTH) {
    return { blocked: true, reason: "too-long" };
  }

  const lower = trimmed.toLowerCase();
  const hit = (patterns: readonly string[]) => patterns.find((pattern) => lower.includes(pattern));

  const instructionHit = hit(INSTRUCTION_OVERRIDE_PATTERNS);
  if (instructionHit) return { blocked: true, reason: `instruction-override:${instructionHit}` };

  const roleHit = hit(ROLE_HIJACK_PATTERNS);
  if (roleHit) return { blocked: true, reason: `role-hijack:${roleHit}` };

  const leakHit = hit(LEAK_PROBE_PATTERNS);
  if (leakHit) return { blocked: true, reason: `leak-probe:${leakHit}` };

  const sqlHit = hit(SQL_INJECTION_PATTERNS);
  if (sqlHit) return { blocked: true, reason: `sql-injection:${sqlHit}` };

  return { blocked: false };
}
