/**
 * 攒钱目标中心的本地状态层（修订案 A17）。
 *
 * 目标列表持久化在 localStorage "spendct:goals:v1"：每个目标记名称、
 * 目标额、目标月（YYYY-MM）与逐笔存入记录（日期 + 金额分）。
 * 页面派生（进度 / 预计达成月 / 加速建议）全部是纯函数、只吃入参，
 * 读写函数只做存储边界（隐私模式下不可写时静默降级），可直接单测。
 */

const STORAGE_KEY = "spendct:goals:v1";

export interface SavingsDeposit {
  /** 存入日 YYYY-MM-DD */
  dateIso: string;
  /** 存入金额（分） */
  cents: number;
}

export interface SavingsGoal {
  /** 稳定标识：创建时生成，列表键与操作目标共用 */
  id: string;
  /** 目标名（用户输入，展示层截断） */
  name: string;
  /** 目标金额（分） */
  targetCents: number;
  /** 目标月 YYYY-MM（展示为「YYYY年M月」） */
  deadlineMonth: string;
  /** 创建日 YYYY-MM-DD */
  createdAt: string;
  /** 逐笔存入记录（时间升序追加） */
  deposits: SavingsDeposit[];
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 读目标列表：整体解析失败按空列表处理，单条不合法跳过（不整表丢弃） */
export function readGoals(): SavingsGoal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const goal = item as Partial<SavingsGoal>;
      if (
        typeof goal.id !== "string" ||
        goal.id.length === 0 ||
        typeof goal.name !== "string" ||
        goal.name.length === 0 ||
        typeof goal.targetCents !== "number" ||
        goal.targetCents <= 0 ||
        typeof goal.deadlineMonth !== "string" ||
        !MONTH_KEY_RE.test(goal.deadlineMonth) ||
        typeof goal.createdAt !== "string" ||
        !DATE_KEY_RE.test(goal.createdAt) ||
        !Array.isArray(goal.deposits)
      ) {
        return [];
      }
      const deposits: SavingsDeposit[] = goal.deposits.flatMap((dep) => {
        if (!dep || typeof dep !== "object") return [];
        const d = dep as Partial<SavingsDeposit>;
        if (
          typeof d.dateIso !== "string" ||
          !DATE_KEY_RE.test(d.dateIso) ||
          typeof d.cents !== "number" ||
          d.cents <= 0
        ) {
          return [];
        }
        return [{ dateIso: d.dateIso, cents: Math.round(d.cents) }];
      });
      return [
        {
          id: goal.id,
          name: goal.name,
          targetCents: Math.round(goal.targetCents),
          deadlineMonth: goal.deadlineMonth,
          createdAt: goal.createdAt,
          deposits,
        },
      ];
    });
  } catch {
    // 存储不可用（隐私模式）或内容损坏：按空列表处理
    return [];
  }
}

/** 写目标列表：隐私模式不可写时静默降级（仅本次会话生效） */
export function saveGoals(goals: SavingsGoal[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
  } catch {
    // 隐私模式不可写：跳过持久化
  }
}

/** 新建目标：追加到列表末尾返回（id 用毫秒时间戳 36 进制，同页连点不会撞） */
export function createGoal(
  goals: SavingsGoal[],
  input: { name: string; targetCents: number; deadlineMonth: string },
): SavingsGoal[] {
  // 创建日取本地钟表分量（不用 toISOString：UTC 格式化会漂一天），与其他日期键同口径
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const goal: SavingsGoal = {
    id: `goal-${Date.now().toString(36)}`,
    name: input.name.trim(),
    targetCents: Math.round(input.targetCents),
    deadlineMonth: input.deadlineMonth,
    createdAt: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    deposits: [],
  };
  return [...goals, goal];
}

/** 记录一笔存入（追加到目标存款列表末尾），返回更新后的列表 */
export function addDeposit(
  goals: SavingsGoal[],
  goalId: string,
  dateIso: string,
  cents: number,
): SavingsGoal[] {
  return goals.map((goal) =>
    goal.id === goalId
      ? { ...goal, deposits: [...goal.deposits, { dateIso, cents: Math.round(cents) }] }
      : goal,
  );
}

/** 删除目标，返回更新后的列表 */
export function removeGoal(goals: SavingsGoal[], goalId: string): SavingsGoal[] {
  return goals.filter((goal) => goal.id !== goalId);
}

/** 已存金额：全部存入记录求和 */
export function totalSaved(goal: SavingsGoal): number {
  return goal.deposits.reduce((sum, dep) => sum + dep.cents, 0);
}

/**
 * 距达成还需几个月：结余 0 或负数时返回 null（无法预估，界面显示「暂无法估算」）；
 * 已达成返回 0。向上取整——差 1 分也是 1 个月。
 */
export function monthsToGoal(
  savedCents: number,
  targetCents: number,
  surplusCents: number,
): number | null {
  const remain = targetCents - savedCents;
  if (remain <= 0) return 0;
  if (surplusCents <= 0) return null;
  return Math.ceil(remain / surplusCents);
}

/** YYYY-MM 加自然月：跨年由 Date 归一（日固定为 1，避免月末溢出） */
export function addMonths(monthKey: string, months: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, 1);
  date.setMonth(date.getMonth() + months);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** YYYY-MM → 「YYYY年M月」展示（与月份选择器的 option 标签同口径） */
export function formatMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${y ?? 0}年${m ?? 0}月`;
}

/** 当前月键：本地钟表分量（不用 toISOString，UTC 会漂月） */
export function currentMonthKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** 两个月份键的自然月差：toMonth − fromMonth（toMonth 在前时为负数），目标月余量计算用 */
export function monthsBetween(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return ((ty ?? 0) - (fy ?? 0)) * 12 + ((tm ?? 0) - (fm ?? 0));
}
