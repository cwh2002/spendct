/**
 * 通知中心派生层（F13 规格落地）。
 *
 * 设计取舍：通知不做「事件落库」，而是每次渲染时从存量状态确定性重算。
 * 三条规则（订阅扣费临近 / 预算使用率 ≥80% / 断点续跑）都由已存在的
 * 数据源直接推导，不存在「发过又删除」的脏状态；已读 id 集合单独持久化，
 * 刷新后已读不复活，同一规则跨天触发时以新日期生成新 id 重新出现。
 * deriveNotifications 是纯函数（全部数据经参数注入，不碰任何存储），
 * 单测可直接在 node 环境断言；存储读写与 DuckDB 装载是另一层，
 * 只在浏览器里由 top-nav / 设置页调用。
 */
import { DEMO_BUDGET } from "@/lib/demo-data";
import { getDuckDB } from "@/lib/duckdb/service";
import { STAGE_DISPLAY_NAMES } from "@/lib/pipeline/stage";
import { runWhitelistedAggregate } from "@/lib/sql-guard/whitelist";

/* ---------------- 类型与阈值 ---------------- */

export type NotificationKind = "sub-due" | "budget-over" | "resume";

export interface NotificationItem {
  /** kind + 本地日期稳定生成：同一天同一规则只出一条，跨天自动出新 */
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** 派生时间戳（注入 now 缺省 Date.now()） */
  ts: number;
}

export interface NotifSettings {
  subDue: boolean;
  budgetOver: boolean;
  resume: boolean;
}

/** 订阅规则输入：通知正文不出现商户名，只关心扣费临近与金额 */
export interface NotifSubscription {
  id: string;
  amountCents: number;
  nextChargeInDays: number;
}

/** 预算快照：本月已用 / 预算（分），null = 无预算数据，规则②不触发 */
export interface NotifBudgetSnapshot {
  usedCents: number;
  budgetCents: number;
}

/** 断点输入：只需阶段 id（展示名经 STAGE_DISPLAY_NAMES 换算） */
export interface NotifCheckpoint {
  stage: string;
}

export interface DeriveNotifInputs {
  subscriptions: readonly NotifSubscription[];
  budget: NotifBudgetSnapshot | null;
  checkpoint: NotifCheckpoint | null;
  settings: NotifSettings;
  /** 派生时间戳：测试注入固定值保证 id 可断言 */
  now?: number;
}

/** 订阅扣费临近阈值：下次扣费 ≤ 3 天（F13 规则①） */
export const SUB_DUE_WINDOW_DAYS = 3;
/** 预算使用率告警阈值：≥ 80%（F13 规则②） */
export const BUDGET_WARN_RATIO = 0.8;

/* ---------------- 存储键 ---------------- */

/**
 * 通知存储键：与设置页通知开关共用一个对象 { subDue, budgetOver, resume, read }。
 * 历史兼容：设置页早期只写开关三字段，旧值没有 read 字段，解析时按空已读集合处理。
 */
export const NOTIF_STORAGE_KEY = "spendct:notif:v1";
/** 预算覆盖键（预算页 KEY_BUDGET 同键，06 §7 修订案 A1 允许的 UI 状态键） */
export const BUDGET_OVERRIDES_KEY = "spendct:budget:v1";
/** 手动账本键（预算页 KEY_MANUAL 同键） */
export const MANUAL_ENTRIES_KEY = "spendct:manual-entries";

const DEFAULT_NOTIF_SETTINGS: NotifSettings = { subDue: true, budgetOver: true, resume: true };

/* ---------------- 纯派生 ---------------- */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 分 → 元字符串（两位小数，通知正文用，不做千分位避免噪声） */
function fmtYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** id = kind + 本地日期：同规则当天去重，跨天自然出新 */
function notifId(kind: NotificationKind, now: number): string {
  const d = new Date(now);
  return `${kind}-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 派生通知列表（纯函数，可注入）。
 * 三条规则按序拼接，各自受设置开关闸门控制；同一天同规则只出一条。
 */
export function deriveNotifications(inputs: DeriveNotifInputs): NotificationItem[] {
  const now = inputs.now ?? Date.now();
  const items: NotificationItem[] = [];

  // ① 订阅扣费临近：窗口内命中项聚合为一条（金额合计，天数取最近的一次）
  if (inputs.settings.subDue) {
    const due = inputs.subscriptions.filter(
      (s) => s.nextChargeInDays >= 0 && s.nextChargeInDays <= SUB_DUE_WINDOW_DAYS,
    );
    if (due.length > 0) {
      const totalCents = due.reduce((sum, s) => sum + s.amountCents, 0);
      const nearest = Math.min(...due.map((s) => s.nextChargeInDays));
      items.push({
        id: notifId("sub-due", now),
        kind: "sub-due",
        title: "订阅扣费临近",
        body:
          due.length === 1
            ? `有 1 项订阅将在 ${nearest} 天内扣费 ¥${fmtYuan(totalCents)}`
            : `有 ${due.length} 项订阅将在 ${nearest} 天内扣费，合计约 ¥${fmtYuan(totalCents)}`,
        ts: now,
      });
    }
  }

  // ② 预算使用率 ≥ 80%：预算为 0 或快照缺失时不触发（避免除零与空态误报）
  if (inputs.settings.budgetOver && inputs.budget && inputs.budget.budgetCents > 0) {
    const ratio = inputs.budget.usedCents / inputs.budget.budgetCents;
    if (ratio >= BUDGET_WARN_RATIO) {
      items.push({
        id: notifId("budget-over", now),
        kind: "budget-over",
        title: "预算使用率已达 80%",
        body: `本月已用 ¥${fmtYuan(inputs.budget.usedCents)} / 预算 ¥${fmtYuan(inputs.budget.budgetCents)}，使用率 ${Math.round(ratio * 100)}%`,
        ts: now,
      });
    }
  }

  // ③ 断点续跑：checkpoint 键存在且 paused（readPausedCheckpoint 已校验 paused=true）
  if (inputs.settings.resume && inputs.checkpoint) {
    const display =
      (STAGE_DISPLAY_NAMES as Record<string, { name: string } | undefined>)[
        inputs.checkpoint.stage
      ];
    const stageName = display?.name ?? inputs.checkpoint.stage;
    items.push({
      id: notifId("resume", now),
      kind: "resume",
      title: "体检还没做完",
      body: `上次体检暂停在「${stageName}」阶段，进度已保存在本机，可以回来接着做`,
      ts: now,
    });
  }

  return items;
}

/** 未读数：列表与已读 id 集合求差 */
export function countUnread(
  items: readonly NotificationItem[],
  readIds: readonly string[],
): number {
  return items.reduce((count, item) => count + (readIds.includes(item.id) ? 0 : 1), 0);
}

/* ---------------- 存储读写（浏览器侧） ---------------- */

export interface NotifStorage {
  settings: NotifSettings;
  read: string[];
}

/** 读通知存储：开关三字段与已读 id 数组同一对象，损坏内容按默认值兜底 */
export function readNotifStorage(): NotifStorage {
  const fallback: NotifStorage = { settings: { ...DEFAULT_NOTIF_SETTINGS }, read: [] };
  try {
    const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<NotifSettings> & { read?: unknown };
    const read = Array.isArray(parsed.read)
      ? parsed.read.filter((id): id is string => typeof id === "string")
      : [];
    return {
      settings: {
        subDue: parsed.subDue ?? DEFAULT_NOTIF_SETTINGS.subDue,
        budgetOver: parsed.budgetOver ?? DEFAULT_NOTIF_SETTINGS.budgetOver,
        resume: parsed.resume ?? DEFAULT_NOTIF_SETTINGS.resume,
      },
      read,
    };
  } catch {
    // 隐私模式禁 localStorage / 内容损坏：按默认开关与空已读处理
    return fallback;
  }
}

/** 读-改-写合并：开关与已读共用一个键，任何一方写入都必须带上另一方，否则互相覆盖 */
function writeNotifStorage(next: NotifStorage): void {
  try {
    localStorage.setItem(
      NOTIF_STORAGE_KEY,
      JSON.stringify({ ...next.settings, read: next.read }),
    );
  } catch {
    // 写入失败静默：本次会话内状态照常工作，仅不持久化
  }
}

/** 标记单条已读（幂等） */
export function markNotifRead(id: string): void {
  const current = readNotifStorage();
  if (current.read.includes(id)) return;
  writeNotifStorage({ ...current, read: [...current.read, id] });
}

/** 全部标为已读（按当前派生列表的 id 集合合并） */
export function markAllNotifRead(ids: readonly string[]): void {
  const current = readNotifStorage();
  writeNotifStorage({ ...current, read: [...new Set([...current.read, ...ids])] });
}

/** 通知开关写入（设置页调用）：合并已读数组，不再整体覆盖存储对象 */
export function writeNotifSettings(patch: Partial<NotifSettings>): void {
  const current = readNotifStorage();
  writeNotifStorage({ settings: { ...current.settings, ...patch }, read: current.read });
}

/* ---------------- 预算快照（与预算页同口径） ---------------- */

interface ManualEntryLike {
  ts?: unknown;
  direction?: unknown;
  amountCents?: unknown;
}

/** 本月手动记账支出合计（收入不计入预算口径，与预算页 mergeManualExpenses 一致） */
function sumManualExpenseThisMonth(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  const now = new Date();
  const prefix = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  let total = 0;
  for (const entry of raw as ManualEntryLike[]) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.direction === "income") continue;
    if (typeof entry.ts !== "string" || !entry.ts.startsWith(prefix)) continue;
    const cents =
      typeof entry.amountCents === "number"
        ? Math.round(entry.amountCents)
        : Number(entry.amountCents);
    if (Number.isFinite(cents) && cents > 0) total += cents;
  }
  return total;
}

/**
 * 预算快照（与预算页「本月总览」同口径，08 修订案）：
 * - demo 动线：已用 = 演示类目月支出 + 本月手动记账；预算 = 演示默认档叠加本地覆盖；
 * - 真实动线：已用 = 近 90 天类目支出 ÷ 窗口自然月数（月均口径，不用残缺当月行）
 *   + 本月手动记账；预算 = 覆盖值 ?? 演示默认 ?? 月均基线（向上取整到元）；
 * - 预算合计为 0 时返回 null（规则②不触发）。
 */
export function buildBudgetSnapshot(input: {
  /** 近 90 天类目支出（分）；null = demo 动线 */
  category90d: Record<string, number> | null;
  /** 90 天窗口覆盖的自然月数（≥1） */
  windowMonths: number;
  /** 预算覆盖值 { 类别: 预算分 } */
  overrides: Record<string, number>;
  /** 手动账本原始存储数组（坏行静默跳过） */
  manualEntries?: unknown;
}): NotifBudgetSnapshot | null {
  const overrides = input.overrides ?? {};
  const demoBudget = new Map(DEMO_BUDGET.categories.map((c) => [c.category, c.budgetCents]));
  const manualCents = sumManualExpenseThisMonth(input.manualEntries);

  if (!input.category90d) {
    const used =
      DEMO_BUDGET.categories.reduce((sum, c) => sum + c.actualCents, 0) + manualCents;
    const budget = DEMO_BUDGET.categories.reduce(
      (sum, c) => sum + (overrides[c.category] ?? c.budgetCents),
      0,
    );
    return budget > 0 ? { usedCents: used, budgetCents: budget } : null;
  }

  const divisor = Math.max(input.windowMonths, 1);
  const names = new Set([...Object.keys(input.category90d), ...Object.keys(overrides)]);
  let used = 0;
  let budget = 0;
  for (const name of names) {
    const monthlyAvg = Math.round((input.category90d[name] ?? 0) / divisor);
    used += monthlyAvg;
    // 无覆盖无演示默认的类目：以自身月均向上取整到元作预算（与预算页基线同口径）
    const baseline = Math.ceil(monthlyAvg / 100) * 100;
    budget += overrides[name] ?? demoBudget.get(name) ?? baseline;
  }
  return budget > 0 ? { usedCents: used + manualCents, budgetCents: budget } : null;
}

/** 读预算覆盖值：存储内容不受程序校验约束，坏形态降级为空对象 */
export function readBudgetOverrides(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BUDGET_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读手动账本原始数组（sanitize 交给 buildBudgetSnapshot 内部逐行防御） */
export function readManualEntries(): unknown {
  try {
    const raw = localStorage.getItem(MANUAL_ENTRIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ---------------- 真实数据装载（浏览器侧，top-nav 异步调用） ---------------- */

/**
 * 订阅命中查询：与订阅页 SUBSCRIPTION_PATTERNS_SQL 同口径（07 §3 预计算表
 * subscription_patterns，按 merchant 分组后其余列取 MAX 即组内原值），
 * 列序契约：0 merchant / 1 n / 2 last_ts / 3 avg_cents / 4 avg_interval_days。
 */
const SUBSCRIPTION_PATTERNS_SQL =
  "SELECT merchant, MAX(n), MAX(last_ts), MAX(avg_cents), MAX(avg_interval_days) " +
  "FROM subscription_patterns GROUP BY merchant ORDER BY MAX(last_ts) DESC LIMIT 50";

/** 分类支出查询：与预算页 SQL_CATEGORY_MONTHLY_RECENT 同口径，JS 侧截最近 3 个自然月 */
const CATEGORY_MONTHLY_RECENT_SQL =
  "SELECT category, month, SUM(expense_cents) FROM v_category_monthly GROUP BY category, month ORDER BY month DESC LIMIT 48";

/** 90 天窗口自然月数（与预算页 CATEGORY_WINDOW_MONTHS 一致） */
const CATEGORY_WINDOW_MONTHS = 3;

/** 行内按 SELECT 列位置取值（DuckDB 自动列名不稳定，与管线引擎同口径） */
function cellAt(row: Record<string, unknown>, index: number): unknown {
  return Object.values(row)[index] ?? null;
}

/** 按列位置取数值：兼容 BIGINT 物化为 bigint/number/string 的形态 */
function numCell(row: Record<string, unknown>, index: number): number {
  const value = cellAt(row, index);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** DuckDB 时间单元格 → YYYY-MM-DD（兼容 Date / ISO 字符串 / 微秒整数，与订阅页同口径） */
function fmtDateCell(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "bigint") {
    const date = new Date(Number(value / 1000n));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  return String(value ?? "").slice(0, 10);
}

/** 时间单元格 → YYYY-MM（与预算页 monthKeyOf 同口径，解析失败返回空串） */
function monthKeyOf(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : typeof value === "string"
          ? new Date(value)
          : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** 周期分桶（与订阅页 cycleOf 同口径：25-40 天候选几乎全落 monthly） */
function cycleOf(avgIntervalDays: number): "daily" | "weekly" | "monthly" | "yearly" {
  if (avgIntervalDays <= 2) return "daily";
  if (avgIntervalDays <= 15) return "weekly";
  if (avgIntervalDays <= 92) return "monthly";
  return "yearly";
}

/** 周期步进（dir +1 前进 / -1 后退；跨月按目标月末日截断，与订阅页 stepCycle 同口径） */
function stepCycle(
  date: Date,
  cycle: "daily" | "weekly" | "monthly" | "yearly",
  dir: 1 | -1,
): Date {
  const d = new Date(date);
  if (cycle === "daily") {
    d.setDate(d.getDate() + dir);
    return d;
  }
  if (cycle === "weekly") {
    d.setDate(d.getDate() + 7 * dir);
    return d;
  }
  if (cycle === "monthly") {
    const targetMonth = d.getMonth() + dir;
    const probe = new Date(d.getFullYear(), targetMonth, 1);
    const lastDay = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
    d.setMonth(targetMonth, Math.min(d.getDate(), lastDay));
    return d;
  }
  const targetYear = d.getFullYear() + dir;
  const probe = new Date(targetYear, 1, 1);
  const lastDay = new Date(probe.getFullYear(), 2, 0).getDate();
  d.setFullYear(targetYear, 1, Math.min(d.getDate(), lastDay));
  return d;
}

/**
 * 真实动线通知数据装载（有体检结果时调用）：
 * - 订阅：日期锚 = 全部命中行最大 last_ts，next = last_ts 前进一个周期后距锚日天数
 *   （确定性口径，不读系统时钟，与订阅页一致）；
 * - 预算：近 3 自然月类目支出 → buildBudgetSnapshot（叠加本地覆盖与手动记账）。
 * 模块级降级：任一查询失败只置空对应模块，不影响另一条规则。
 */
export async function loadRealNotifData(): Promise<{
  subs: NotifSubscription[];
  budget: NotifBudgetSnapshot | null;
}> {
  const conn = await getDuckDB();
  const result: { subs: NotifSubscription[]; budget: NotifBudgetSnapshot | null } = {
    subs: [],
    budget: null,
  };

  try {
    const patterns = await runWhitelistedAggregate(conn, SUBSCRIPTION_PATTERNS_SQL);
    const rows = patterns.rows as Record<string, unknown>[];
    const lastDates = rows
      .map((row) => fmtDateCell(cellAt(row, 2)))
      .filter((iso) => iso.length === 10);
    const anchorMs =
      lastDates.length > 0
        ? Math.max(...lastDates.map((iso) => new Date(`${iso}T00:00:00`).getTime()))
        : 0;
    for (const row of rows) {
      const lastIso = fmtDateCell(cellAt(row, 2));
      const n = numCell(row, 1);
      const avgCents = numCell(row, 3);
      const avgIntervalDays = numCell(row, 4);
      const lastDate = new Date(`${lastIso}T00:00:00`);
      // 脏行防御：末次扣费日期缺失/无效或无命中笔数的行跳过
      if (lastIso.length !== 10 || Number.isNaN(lastDate.getTime()) || n <= 0) continue;
      const cycle = cycleOf(avgIntervalDays > 0 ? avgIntervalDays : 30);
      const nextMs = stepCycle(lastDate, cycle, 1).getTime();
      const nextChargeInDays =
        anchorMs > 0 ? Math.max(0, Math.round((nextMs - anchorMs) / 86_400_000)) : 0;
      result.subs.push({
        // 行内无唯一业务键，用日期+间隔拼出稳定 id（仅通知去重用，不进展示）
        id: `sub-${lastIso}-${avgIntervalDays}`,
        amountCents: Math.round(avgCents),
        nextChargeInDays,
      });
    }
  } catch {
    // 订阅查询失败：保持空列表，该规则不触发
  }

  try {
    const cat = await runWhitelistedAggregate(conn, CATEGORY_MONTHLY_RECENT_SQL);
    const rows = cat.rows as Record<string, unknown>[];
    // JS 侧截最近 3 个自然月并按类目求和（month DESC 序，超窗的更早月份跳过）
    const windowKeys: string[] = [];
    const byCategory: Record<string, number> = {};
    for (const row of rows) {
      const category = String(cellAt(row, 0) ?? "");
      const monthKey = monthKeyOf(cellAt(row, 1));
      const expenseCents = numCell(row, 2);
      if (category === "" || monthKey === "") continue;
      if (!windowKeys.includes(monthKey)) {
        if (windowKeys.length < CATEGORY_WINDOW_MONTHS) windowKeys.push(monthKey);
        else continue;
      }
      byCategory[category] = (byCategory[category] ?? 0) + expenseCents;
    }
    if (Object.values(byCategory).some((v) => v > 0)) {
      result.budget = buildBudgetSnapshot({
        category90d: byCategory,
        windowMonths: Math.max(windowKeys.length, 1),
        overrides: readBudgetOverrides(),
        manualEntries: readManualEntries(),
      });
    }
  } catch {
    // 预算查询失败：保持 null，该规则不触发
  }

  return result;
}
