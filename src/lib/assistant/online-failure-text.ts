/**
 * 在线兜底失败提示（08 修订案 A18 热修复五轮 + 复审修补）：按失败原因分档。
 *
 * 此前所有在线失败（未配置密钥 / 网络不通 / 服务端 5xx / 参数校验 /
 * 停滞超时）都落同一句「这个问题需要连接在线服务才能回答」——主谓
 * 不明，用户把它读成「需要自己手动连接大模型」。现在按失败原因分档：
 * 未配置密钥给出配置指引（并声明系统自动接入、无需手动连接），超时 /
 * 网络 / 服务端错误分别提示原因与动作。
 *
 * 复审修补（2026-10-17）：① 402/429 额度类错误新增独立档（提示稍后
 * 再试，不再误导检查网络）；② 超时档不再归因网络（停滞可能只是响应
 * 慢，不能怪网络）；③ LLM_EXHAUSTED 档按服务端消息区分「未配置」与
 * 「密钥无效/过期」两态，都不再写死部署路径；④ 未覆盖档换掉旧句
 * 「这个问题需要连接在线服务才能回答」，恢复成可用性描述。
 *
 * 纯函数模块（不依赖 React）：单测直接 import，锁定各档文案口径。
 */
import { EXAMPLE_QUESTIONS } from "@/lib/chat/qa-engine";

/** 在线失败原因（SSE error 事件 code 与本地判定共用同一枚举） */
export type OnlineFailureKind =
  | "LLM_EXHAUSTED"
  | "TIMEOUT"
  | "NETWORK_OFFLINE"
  | "HTTP_ERROR"
  | "QUOTA_EXCEEDED"
  | "UNKNOWN";

/** SSE error 事件 code → 失败原因（与服务端 route.ts 的 code 枚举对齐） */
export function mapErrorCode(code: string | undefined): OnlineFailureKind {
  switch (code) {
    case "LLM_EXHAUSTED":
      return "LLM_EXHAUSTED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "NETWORK_OFFLINE":
      return "NETWORK_OFFLINE";
    case "QUOTA_EXCEEDED":
      return "QUOTA_EXCEEDED";
    case "BAD_REQUEST":
      return "HTTP_ERROR";
    default:
      return "UNKNOWN";
  }
}

/** 其余档的定性说明：在线服务是系统行为，用户无需任何手动操作 */
const AUTO_NOTE = "（在线服务由系统自动连接，无需手动操作。）";

/** 组装完整提示：原因段 + 本地可答示例问题 */
function tip(lines: string[]): string {
  const samples = EXAMPLE_QUESTIONS.slice(0, 3).map((question) => `· ${question}`);
  return [...lines, "可以先试试下面这些问题：", ...samples].join("\n");
}

/** 按失败原因生成提示气泡文案（detail 为原因补充说明，可选） */
export function onlineFailureTipText(kind: OnlineFailureKind, detail?: string): string {
  switch (kind) {
    case "LLM_EXHAUSTED": {
      // 服务端消息可区分「密钥无效/过期」与「未配置」两态，分别给出对应指引
      const invalid = detail?.includes("无效") || detail?.includes("过期");
      const line = invalid
        ? "在线模型密钥无效或已过期。密钥是服务端配置项，服务端更换后系统自动接入，聊天页面无需手动操作；配置期间可先问我本地能算的问题。"
        : "在线模型暂未就绪：服务端尚未配置 DEEPSEEK_API_KEY。密钥是服务端配置项，配置后系统自动接入，聊天页面无需手动连接；配置期间可先问我本地能算的问题。";
      return tip([line]);
    }
    case "TIMEOUT":
      // 停滞可能是服务繁忙或响应慢，不归因网络（本地阶段卡住更不能怪网络）
      return tip(["等待在线分析响应超时（可能响应较慢），请再问一次。", AUTO_NOTE]);
    case "NETWORK_OFFLINE":
      return tip(["在线服务连接失败，请检查网络后重试。", AUTO_NOTE]);
    case "HTTP_ERROR": {
      // 400 是请求内容问题（重试必败），其余状态码按服务端临时出错提示
      const line =
        detail === "400"
          ? "在线分析暂时不可用（请求内容超出接口限制，HTTP 400），可以先问本地能算的问题。"
          : `在线服务暂时出错（HTTP ${detail ?? "错误"}），请稍后重试；若反复出现，可先问本地能算的问题。`;
      return tip([line, AUTO_NOTE]);
    }
    case "QUOTA_EXCEEDED":
      return tip(["在线模型额度不足或请求过于频繁，请稍后再试。", AUTO_NOTE]);
    default:
      return tip(["这个问题需要在线模型回答，但在线服务暂时不可用，请稍后重试。", AUTO_NOTE]);
  }
}

/** 流已收到内容时错误收尾的补注（与超时补注 INTERRUPTED_NOTE 同模式） */
export function onlineErrorNote(code: string | undefined): string {
  const kind = mapErrorCode(code);
  let reason: string;
  if (kind === "LLM_EXHAUSTED") {
    reason = "在线模型未就绪（密钥未配置或已失效）";
  } else if (kind === "TIMEOUT") {
    reason = "在线服务响应超时";
  } else if (kind === "NETWORK_OFFLINE") {
    reason = "在线服务网络异常";
  } else if (kind === "QUOTA_EXCEEDED") {
    reason = "在线模型额度受限";
  } else {
    reason = "在线服务出错";
  }
  const tail = kind === "LLM_EXHAUSTED" ? "配置就绪后再问一次" : "请再问一次";
  return `\n\n（回答中断：${reason}，${tail}。）`;
}
