/**
 * /api/followup SSE 流解析器（追问面板与智能助理共用的帧级解析层，07 §2 + 修订案 A12）。
 *
 * 从追问面板在线兜底的帧解析实现抽取为独立生成器：把 Response 按 SSE 空行
 * 分帧、剥 data: 前缀、解析事件对象，产出类型化的流事件序列，面板与助理
 * 各自决定如何渲染。行为与原面板实现逐条对齐：
 *   - tool:start / tool:end：工具调用起止（徽章三态）；
 *   - stage:thinking：回答文本增量；
 *   - plan：思考计划（修订案 A12 新增事件，协议 §2 第 21 类）；
 *   - run:complete / error / abort：流收尾；
 *   - keepalive：服务端注释心跳帧（「: keepalive」）映射成的事件，面板借此
 *     重置流内停滞计时——LLM 首 token / 工具等待可能超过 30s 停滞窗，
 *     心跳帧证明链路仍活跃（A18 热修复四轮）；
 *   - 坏帧静默跳过，不阻断后续事件；流结束仍有未分帧余量时按整帧兜底。
 *
 * 纯逻辑模块：不依赖 React；中止信号由调用方传入 fetch，reader.read()
 * 在中止时抛错，本生成器不捕获——中止与否是调用方的决定。
 */

/** 思考计划的一个步骤（plan 事件携带，A12） */
export interface FollowupPlanStep {
  /** 步骤标题（一句中文） */
  title: string;
  /** 步骤用到的工具短名（与工具徽章联动；无工具步骤为空） */
  tool?: string;
  /** 该步骤的用途说明（可空） */
  purpose?: string;
}

/** 流事件的判别联合：与 /api/followup 发帧口径一一对应 */
export type FollowupStreamEvent =
  | { type: "tool-start"; tool: string; argsDigest?: string }
  | { type: "tool-end"; tool: string; ok: boolean; ms?: number; errorReason?: string }
  | { type: "text-delta"; text: string }
  | { type: "plan"; goal: string; steps: FollowupPlanStep[] }
  | { type: "complete"; degraded?: string[]; elapsedMs?: number }
  | { type: "error"; code?: string; message?: string }
  | { type: "abort" }
  | { type: "keepalive" };

/** 单帧事件 → 流事件：不认识的帧返回 null（调用方跳过） */
function mapEvent(event: Record<string, unknown>): FollowupStreamEvent | null {
  switch (event.t) {
    case "tool:start":
      return {
        type: "tool-start",
        tool: String(event.tool ?? ""),
        argsDigest: typeof event.argsDigest === "string" ? event.argsDigest : undefined,
      };
    case "tool:end":
      return {
        type: "tool-end",
        tool: String(event.tool ?? ""),
        ok: Boolean(event.ok),
        ms: typeof event.ms === "number" ? event.ms : undefined,
        errorReason: typeof event.errorReason === "string" ? event.errorReason : undefined,
      };
    case "plan": {
      const rawSteps = Array.isArray(event.steps) ? event.steps : [];
      const steps: FollowupPlanStep[] = [];
      for (const raw of rawSteps) {
        if (typeof raw !== "object" || raw === null) continue;
        const step = raw as Record<string, unknown>;
        const title = String(step.title ?? "").trim();
        if (!title) continue;
        steps.push({
          title,
          tool: typeof step.tool === "string" ? step.tool : undefined,
          purpose: typeof step.purpose === "string" ? step.purpose : undefined,
        });
      }
      return { type: "plan", goal: String(event.goal ?? ""), steps };
    }
    case "stage:thinking":
      if (typeof event.text === "string") return { type: "text-delta", text: event.text };
      return null;
    case "run:complete":
      return {
        type: "complete",
        degraded: Array.isArray(event.degraded)
          ? event.degraded.filter((d): d is string => typeof d === "string")
          : undefined,
        elapsedMs: typeof event.elapsedMs === "number" ? event.elapsedMs : undefined,
      };
    case "error":
      return {
        type: "error",
        code: typeof event.code === "string" ? event.code : undefined,
        message: typeof event.message === "string" ? event.message : undefined,
      };
    case "abort":
      return { type: "abort" };
    default:
      return null;
  }
}

/** 单帧文本 → 流事件（坏 JSON / 不认识的帧返回 null，由调用方静默跳过） */
function parseFrame(frame: string): FollowupStreamEvent | null {
  // SSE 注释帧（以「:」开头）：服务端心跳，映射成 keepalive 事件
  if (frame.trimStart().startsWith(":")) return { type: "keepalive" };
  const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) return null;
  try {
    return mapEvent(JSON.parse(dataLine.slice(6)) as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * 逐事件消费 /api/followup 的响应流。
 * 调用方在收到 complete / error / abort 后自行停止迭代（break 触发生成器
 * 收尾并释放 reader 锁）。
 */
export async function* streamFollowup(response: Response): AsyncGenerator<FollowupStreamEvent> {
  const body = response.body;
  if (!body) throw new Error("响应没有可读取的数据流");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 按空行分帧；最后一帧可能还没收到空行，留待下一片或流结束处理
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        const event = parseFrame(frame);
        if (event) yield event;
      }
    }
    // 流结束仍有未分帧余量（最后一帧缺空行）：按整帧兜底
    if (buffer.trim().length > 0) {
      const event = parseFrame(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}
