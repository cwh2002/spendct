/**
 * 客户端挂载门控（SSR 水合一致性用）。
 *
 * 服务端渲染与客户端水合首帧均返回 false（与服务器 HTML 同口径），
 * 挂载完成后切换为 true 触发一次重渲染。本地存储、系统时钟等仅
 * 客户端可用的状态一律放在 mounted 为 true 之后再读取/渲染，
 * 避免两端输出不一致触发「Hydration failed」报错。
 */
import { useSyncExternalStore } from "react";

/** 空订阅：挂载门控无外部状态变化，只需 React 在挂载后重读一次快照 */
function noopSubscribe(): () => void {
  return () => {};
}

export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
