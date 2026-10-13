/**
 * 收藏洞察卡的本地持久层（08 修订案 A1：收藏写 spendct:fav:v1）。
 * 收藏是「审阅记录」而非敏感账单数据，存 localStorage 即可跨会话保留；
 * 隐私模式下 localStorage 抛异常时降级为会话内存态（由调用方 state 兜住）。
 */

const FAV_KEY = "spendct:fav:v1";

/** 读取收藏的洞察 id 列表；损坏数据按空列表处理，不让单个脏值弄坏整个页面 */
export function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

/** 切换收藏并落盘，返回新列表（调用方用返回值 setState，保持单一数据源） */
export function toggleFavoriteLocal(ids: string[], id: string): string[] {
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  try {
    window.localStorage.setItem(FAV_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式写失败：本次会话内仍可用（state 已更新），刷新后丢失
  }
  return next;
}
