/**
 * 停滞计时器（A18 热修复）：以「最近一次活动」为基准的超时控制。
 *
 * 与固定总时限的区别：只要调用方持续 reset（例如流每收到一个事件），
 * 计时基准就不断后移，慢而健康的回答永远不会被总时限误杀；只有完全
 * 沉默超过阈值才触发回调。用于在线兜底流的中止保护——覆盖 fetch 首字节
 * 与 SSE 事件之间的所有等待区间（实测 30s 固定总时限曾把 Next dev
 * 首击编译的正常回答误杀成「需连接在线服务」提示）。
 *
 * 阈值可切换（reset 时传入新阈值）：响应前阶段没有任何事件可证明活跃
 * （本地上下文构建、RAG 检索、主 fetch 含 dev 首击编译），用长窗口；
 * 首字节到达后收紧到流内停滞窗口——慢而健康的流靠每事件 reset 存活。
 */

export interface StallTimer {
  /** 重置计时基准（每收到一个流事件调用一次）；传入 stallMs 时同时切换阈值 */
  reset(stallMs?: number): void;
  /** 停止计时（流正常收尾后调用，之后不再触发） */
  clear(): void;
}

/** 创建停滞计时器：创建即开始计时，stallMs 内无 reset 则触发 onFire（只触发一次） */
export function createStallTimer(stallMs: number, onFire: () => void): StallTimer {
  let currentMs = stallMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = (nextMs?: number) => {
    if (nextMs !== undefined) currentMs = nextMs;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onFire();
    }, currentMs);
  };
  arm();
  return {
    reset: arm,
    clear() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
