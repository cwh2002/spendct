/**
 * 商户统计「逐笔明细」页签（08 修订案 A15 第二部分）纯函数单测：
 * 覆盖 DuckDB 行映射（按 SELECT 位置取值、时间串缺失过滤、bigint 金额兜底）、
 * 深夜判定口径（07 §3：23:00-05:00）、收付方向展示文案、关键字过滤
 * （大小写不敏感、空关键字全量）与演示明细行（确定性、时间倒序、深夜行存在）。
 */
import { describe, expect, it } from "vitest";

import {
  buildDemoDetailRows,
  detailRowsFromQuery,
  directionLabel,
  filterDetailRows,
  isNightHour,
} from "@/lib/insights/merchant-detail";

/**
 * 按 SQL 投影列序构造 DuckDB 行（date_iso｜ts_text｜category｜merchant｜
 * amount_cents｜direction｜night_flag）。detailRowsFromQuery 按 Object.values
 * 位置取值，测试行必须与真实投影同列序，spread 覆盖不改变键序。
 */
function duckRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date_iso: "2026-05-01",
    ts_text: "2026-05-01 23:40:15",
    category: "餐饮",
    merchant: "深夜食堂",
    amount_cents: BigInt(3200),
    direction: "expense",
    night_flag: 1,
    ...overrides,
  };
}

describe("detailRowsFromQuery（DuckDB 行 → 明细行）", () => {
  it("按 SELECT 位置映射 7 列：时间串 / 类目 / 商户 / 金额 / 方向 / 深夜标记", () => {
    const rows = detailRowsFromQuery([duckRow()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      tsText: "2026-05-01 23:40:15",
      category: "餐饮",
      merchant: "深夜食堂",
      amountCents: 3200,
      direction: "expense",
      night: true,
    });
  });

  it("金额 bigint / number 兜底转数值，night_flag 0 为非深夜", () => {
    const rows = detailRowsFromQuery([
      duckRow({ amount_cents: BigInt(9900), night_flag: 0 }),
      duckRow({ ts_text: "2026-05-02 12:00:00", amount_cents: 12.6, night_flag: 0 }),
    ]);
    expect(rows[0]!.amountCents).toBe(9900);
    expect(rows[0]!.night).toBe(false);
    expect(rows[1]!.amountCents).toBe(13); // 非整数四舍五入到分
  });

  it("时间串缺失的行过滤掉（无法定位到秒，展示反而误导）", () => {
    const rows = detailRowsFromQuery([
      duckRow({ ts_text: "" }),
      duckRow({ ts_text: null }),
      duckRow({
        ts_text: "2026-05-03 08:00:00",
        category: "购物",
        merchant: "京东商城",
        direction: "income",
        night_flag: 0,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tsText: "2026-05-03 08:00:00",
      category: "购物",
      merchant: "京东商城",
      direction: "income",
      night: false,
    });
  });

  it("类目 / 商户 / 方向空值走兜底：其他 / 未知商户 / expense，金额兜底 0", () => {
    const rows = detailRowsFromQuery([
      duckRow({
        category: null,
        merchant: null,
        amount_cents: null,
        direction: null,
        night_flag: null,
      }),
    ]);
    expect(rows[0]).toMatchObject({
      category: "其他",
      merchant: "未知商户",
      direction: "expense",
      amountCents: 0,
      night: false,
    });
  });
});

describe("isNightHour（07 §3 深夜口径：23:00-05:00）", () => {
  it("23 点与 0-4 点为深夜，5-22 点不是", () => {
    expect(isNightHour(23)).toBe(true);
    expect(isNightHour(0)).toBe(true);
    expect(isNightHour(4)).toBe(true);
    expect(isNightHour(5)).toBe(false);
    expect(isNightHour(12)).toBe(false);
    expect(isNightHour(22)).toBe(false);
  });
});

describe("directionLabel（收付方向 → 展示文案）", () => {
  it("expense=支出、income=收入，其余（含空值）兜底「其他」", () => {
    expect(directionLabel("expense")).toBe("支出");
    expect(directionLabel("income")).toBe("收入");
    expect(directionLabel("")).toBe("其他");
    expect(directionLabel("neutral")).toBe("其他");
  });
});

describe("filterDetailRows（客户端关键字过滤）", () => {
  const rows = [
    { merchant: "美团外卖", category: "餐饮" },
    { merchant: "Steam", category: "娱乐" },
    { merchant: "京东商城", category: "购物" },
  ];

  it("空关键字返回全部副本，不修改原数组", () => {
    const out = filterDetailRows(rows, "  ");
    expect(out).toHaveLength(3);
    expect(out).not.toBe(rows);
  });

  it("按商户或类目匹配，大小写不敏感（steam 命中 Steam）", () => {
    expect(filterDetailRows(rows, "steam").map((r) => r.merchant)).toEqual(["Steam"]);
    expect(filterDetailRows(rows, "美团").map((r) => r.merchant)).toEqual(["美团外卖"]);
    expect(filterDetailRows(rows, "购物").map((r) => r.merchant)).toEqual(["京东商城"]);
  });

  it("无匹配返回空数组", () => {
    expect(filterDetailRows(rows, "不存在的关键字")).toEqual([]);
  });
});

describe("buildDemoDetailRows（确定性演示明细行）", () => {
  it("固定 100 行（与演示账本行数一致），两次调用结果完全相同", () => {
    const a = buildDemoDetailRows();
    const b = buildDemoDetailRows();
    expect(a).toHaveLength(100);
    expect(a).toEqual(b);
  });

  it("时间串为 YYYY-MM-DD HH:MM:SS，按时间倒序排列", () => {
    const rows = buildDemoDetailRows();
    for (const row of rows) {
      expect(row.tsText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
    const sorted = [...rows].sort((x, y) => (x.tsText < y.tsText ? 1 : -1));
    expect(rows).toEqual(sorted);
  });

  it("深夜行存在，night 标记与 tsText 小时分量经 isNightHour 判定一致", () => {
    const rows = buildDemoDetailRows();
    const nightCount = rows.filter((r) => r.night).length;
    expect(nightCount).toBeGreaterThan(0);
    // 两条路径同一口径：演示行的 night 必须等于对自身时间串的深夜判定
    for (const row of rows) {
      const hour = Number(row.tsText.slice(11, 13));
      expect(row.night).toBe(isNightHour(hour));
    }
  });

  it("演示账单全部为支出方向", () => {
    const rows = buildDemoDetailRows();
    expect(rows.every((r) => r.direction === "expense")).toBe(true);
  });
});
