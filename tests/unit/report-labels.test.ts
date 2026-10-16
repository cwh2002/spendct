/**
 * 年度报告文案层纯函数单测（src/lib/report/labels.ts）。
 *
 * labels.ts 只做「数字 → 展示文案」的确定性映射，不参与任何分数计算：
 * 本文件覆盖健康指数评级四档边界、六维三档状态阈值、六维行组装
 * （顺序/状态标签/大白话换算/缺失键兜底）与六维总评大白话的组合规则。
 *
 * 阈值口径与页面四指标卡既有规则一致：餐饮 29.3/40、订阅 3/6、冲动 15/25、
 * 结余 32/15（越高越健康，反向）、深夜 5/10、大额脉冲 10/20。
 * 评分边界仍由报告页 HEALTH_DIMS（fullAt/zeroAt）唯一决定，本模块不覆盖。
 */
import { describe, expect, it } from "vitest";

import {
  buildHealthComment,
  buildHealthDims,
  HEALTH_DIM_DEFS,
  healthDimStatus,
  healthRatingLabel,
  type RatioKey,
} from "@/lib/report/labels";

describe("healthRatingLabel 健康指数评级四档", () => {
  it("≥85 优秀（good），含边界", () => {
    expect(healthRatingLabel(100)).toEqual({ label: "优秀", tone: "good" });
    expect(healthRatingLabel(85)).toEqual({ label: "优秀", tone: "good" });
  });

  it("70-84.9 良好（health），含边界", () => {
    expect(healthRatingLabel(84.9)).toEqual({ label: "良好", tone: "health" });
    expect(healthRatingLabel(70)).toEqual({ label: "良好", tone: "health" });
  });

  it("55-69.9 需关注（warn），含边界", () => {
    expect(healthRatingLabel(69.9)).toEqual({ label: "需关注", tone: "warn" });
    expect(healthRatingLabel(55)).toEqual({ label: "需关注", tone: "warn" });
  });

  it("低于 55 风险（serious），含 0 分", () => {
    expect(healthRatingLabel(54.9)).toEqual({ label: "风险", tone: "serious" });
    expect(healthRatingLabel(0)).toEqual({ label: "风险", tone: "serious" });
  });
});

describe("healthDimStatus 六维三档状态阈值", () => {
  // HEALTH_DIM_DEFS 与页面 HEALTH_DIMS 同序，直接按位取定义
  const food = HEALTH_DIM_DEFS[0]!;
  const sub = HEALTH_DIM_DEFS[1]!;
  const impulse = HEALTH_DIM_DEFS[2]!;
  const night = HEALTH_DIM_DEFS[3]!;
  const surplus = HEALTH_DIM_DEFS[4]!;
  const bigPulse = HEALTH_DIM_DEFS[5]!;

  it("占比类（越低越健康）：≥seriousAt 风险、≥warnAt 注意、其余健康", () => {
    // 餐饮 29.3/40
    expect(healthDimStatus(40, food)).toBe("serious");
    expect(healthDimStatus(29.3, food)).toBe("warn");
    expect(healthDimStatus(29.2, food)).toBe("good");
    // 订阅 3/6
    expect(healthDimStatus(6, sub)).toBe("serious");
    expect(healthDimStatus(3, sub)).toBe("warn");
    expect(healthDimStatus(2.9, sub)).toBe("good");
    // 冲动 15/25
    expect(healthDimStatus(25, impulse)).toBe("serious");
    expect(healthDimStatus(15, impulse)).toBe("warn");
    // 深夜 5/10
    expect(healthDimStatus(10, night)).toBe("serious");
    expect(healthDimStatus(5, night)).toBe("warn");
    // 大额脉冲 10/20
    expect(healthDimStatus(20, bigPulse)).toBe("serious");
    expect(healthDimStatus(10, bigPulse)).toBe("warn");
  });

  it("结余率（越高越健康）：≥goodAt 健康、≥warnAt 注意、其余风险", () => {
    expect(healthDimStatus(32, surplus)).toBe("good");
    expect(healthDimStatus(15, surplus)).toBe("warn");
    expect(healthDimStatus(14.9, surplus)).toBe("serious");
    expect(healthDimStatus(0, surplus)).toBe("serious");
  });
});

describe("buildHealthDims 六维展示行组装", () => {
  /** 内置数据口径的六比率（DEMO_REPORT.healthRatios 同值） */
  const DEMO_RATIOS = {
    foodRatio: 40.9,
    subRatio: 3.2,
    impulseRatio: 7.3,
    nightRatio: 1.7,
    surplusRatio: 13.3,
    bigPulseRatio: 5.6,
  };

  it("按固定顺序组装六行，状态与标签映射正确", () => {
    const rows = buildHealthDims(DEMO_RATIOS);
    expect(rows.map((r) => r.key)).toEqual([
      "foodRatio",
      "subRatio",
      "impulseRatio",
      "nightRatio",
      "surplusRatio",
      "bigPulseRatio",
    ]);
    // 状态：餐饮 40.9 ≥ 40 风险；订阅 3.2 ≥ 3 注意；冲动/深夜健康；
    // 结余 13.3 < 15（反向）风险；大额脉冲健康
    expect(rows.map((r) => r.status)).toEqual([
      "serious",
      "warn",
      "good",
      "good",
      "serious",
      "good",
    ]);
    expect(rows.map((r) => r.statusLabel)).toEqual([
      "风险",
      "注意",
      "健康",
      "健康",
      "风险",
      "健康",
    ]);
    // 比率原值保留（不做取舍），页面按一位小数展示
    expect(rows[0]!.ratio).toBe(40.9);
  });

  it("大白话按「每 100 元」口径换算取整", () => {
    const rows = buildHealthDims(DEMO_RATIOS);
    expect(rows[0]!.plain).toBe("每 100 元支出里，有 41 元花在吃饭上");
    expect(rows[1]!.plain).toBe("每 100 元支出里，有 3 元是订阅自动扣费");
    expect(rows[3]!.plain).toBe("每 100 元支出里，有 2 元花在深夜 23 点到凌晨 5 点");
    expect(rows[4]!.plain).toBe("每 100 元收入里，能存下 13 元");
    expect(rows[5]!.plain).toBe("每 100 元支出里，有 6 元是单笔超过 500 元的大额开销");
  });

  it("缺失键按 0 兜底，不抛异常", () => {
    // 类型层面键齐备，这里用断言模拟运行时字段缺失（如 demo 常量旧版本）的兜底
    const partial = { foodRatio: 10 } as unknown as Record<RatioKey, number>;
    const rows = buildHealthDims(partial);
    expect(rows).toHaveLength(6);
    expect(rows[0]!.ratio).toBe(10);
    expect(rows[1]!.ratio).toBe(0);
    expect(rows[5]!.ratio).toBe(0);
  });
});

describe("buildHealthComment 六维总评大白话", () => {
  it("六项全部健康：中性好评兜底", () => {
    const rows = buildHealthDims({
      foodRatio: 20,
      subRatio: 1,
      impulseRatio: 5,
      nightRatio: 2,
      surplusRatio: 35,
      bigPulseRatio: 5,
    });
    expect(buildHealthComment(rows)).toBe("六个方面都很健康，继续保持现在的消费节奏。");
  });

  it("内置数据口径：先夸可控项，再点出餐饮与结余两个问题项", () => {
    const rows = buildHealthDims({
      foodRatio: 40.9,
      subRatio: 3.2,
      impulseRatio: 7.3,
      nightRatio: 1.7,
      surplusRatio: 13.3,
      bigPulseRatio: 5.6,
    });
    // 冲动/深夜两项健康 → 夸一句；问题按风险优先取前两个
    expect(buildHealthComment(rows)).toBe(
      "冲动和深夜控制得好，主要是餐饮占比偏高、结余率偏低，建议优先调整。",
    );
  });

  it("问题项超过两个：只报最严重的两个（风险优先）", () => {
    const rows = buildHealthDims({
      foodRatio: 40.9, // 风险
      subRatio: 5, // 注意
      impulseRatio: 20, // 注意
      nightRatio: 12, // 风险
      surplusRatio: 13.3, // 风险
      bigPulseRatio: 5.6, // 健康
    });
    // 可控项里没有健康档 → 无夸赞句；三个风险项只取前两个
    expect(buildHealthComment(rows)).toBe(
      "主要是餐饮占比偏高、深夜占比偏高，建议优先调整。",
    );
  });

  it("可控项两项及以上健康时生成夸赞句（取前两个）", () => {
    const rows = buildHealthDims({
      foodRatio: 20,
      subRatio: 1, // 健康
      impulseRatio: 5, // 健康
      nightRatio: 2, // 健康
      surplusRatio: 10, // 结余率反向：10 < 15 → 风险
      bigPulseRatio: 5,
    });
    expect(buildHealthComment(rows)).toBe(
      "订阅和冲动控制得好，主要是结余率偏低，建议优先调整。",
    );
  });

  it("可控项只有一项健康时不生成夸赞句", () => {
    const rows = buildHealthDims({
      foodRatio: 20,
      subRatio: 5, // 注意
      impulseRatio: 20, // 注意
      nightRatio: 2, // 健康（唯一可控健康项，不触发夸赞）
      surplusRatio: 10, // 风险
      bigPulseRatio: 5,
    });
    // 风险优先：结余率偏低排前，订阅占比略高次之
    expect(buildHealthComment(rows)).toBe(
      "主要是结余率偏低、订阅占比略高，建议优先调整。",
    );
  });
});
