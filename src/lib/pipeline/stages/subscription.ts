/**
 * 阶段 4 subscription 订阅陷阱扫描（07 §3 注册表 subscription_patterns，
 * 物化自 v_subscription_candidates：同一商户 ≥3 笔、单笔 100-6000 分、
 * 相邻间隔 25-40 天、金额恒定 ±1%）。
 *
 * 产出 2 张卡：订阅总览（项数/年化/占比）+ 最大订阅项明细。
 * 年化口径 = Σ(扣款笔数 × 单笔均值)；占比分母取 clean 阶段 v_monthly_summary
 * 的支出总额（StageCardContext 跨阶段证据）。无订阅命中时产「未发现」卡，
 * 由 reflect 闸门按零样本拦下。
 */
import {
  fmtYuan,
  makeCardId,
  noFindingsInput,
  numAt,
  ragCitation,
  ruleCitation,
  sqlCitation,
  valAt,
  type CitationInput,
  type StageExecutor,
  type TemplateCardInput,
} from "./spec";
import tfidfManifest from "@/data/tfidf-manifest.json";
import { CASES } from "@/lib/cases";
import { tfidfSearch, type TfidfManifest } from "@/lib/rag/tfidf";
import { TFIDF_CITE_MIN } from "@/lib/rag/types";

export const SUBSCRIPTION_EXECUTOR: StageExecutor = {
  stage: "subscription",
  queries: [
    {
      tableId: "subscription_patterns",
      sql: "SELECT merchant, SUM(n), AVG(avg_cents), AVG(avg_interval_days), SUM(months_active) FROM subscription_patterns GROUP BY merchant ORDER BY AVG(avg_cents) DESC LIMIT 50",
    },
  ],
  buildCardInputs(evidence, ctx) {
    const patterns = evidence[0]!;
    const inputs: TemplateCardInput[] = [];

    const rows = patterns.rows
      .filter((row) => numAt(row, 1) > 0)
      .sort((a, b) => numAt(b, 2) - numAt(a, 2));

    if (rows.length === 0) {
      inputs.push(
        noFindingsInput("subscription", 1, {
          headline: "未发现周期订阅扣费",
          narrative: "未检测到满足周期规则的重复扣款商户，固定成本层健康。",
          tableId: "subscription_patterns",
        }),
      );
      return inputs;
    }

    const totalYear = rows.reduce((sum, row) => sum + numAt(row, 1) * numAt(row, 2), 0);
    const cleanMonthly = ctx.getEvidence("clean")[1];
    const totalExpense = cleanMonthly
      ? cleanMonthly.rows.reduce((sum, row) => sum + numAt(row, 1), 0)
      : 0;
    const sharePct = totalExpense > 0 ? ((totalYear / totalExpense) * 100).toFixed(1) : "0.0";

    const top = rows[0]!;
    const topMerchant = String(valAt(top, 0));
    const second = rows[1];

    // 卡 1：订阅总览
    const narrativeParts = [
      `检测到 ${rows.length} 项按固定周期重复扣款的订阅：` +
        `${topMerchant} 单笔均值 ¥${fmtYuan(numAt(top, 2))}`,
    ];
    if (second) {
      narrativeParts.push(`、${String(valAt(second, 0))} 单笔均值 ¥${fmtYuan(numAt(second, 2))}`);
    }
    narrativeParts.push(
      `。按当前频率年化合计约 ¥${fmtYuan(totalYear)}，占体检期支出的 ${sharePct}%。` +
        `建议逐项核对仍在续费的订阅，及时取消不再使用的项目。`,
    );

    inputs.push({
      cardId: makeCardId("subscription", 1),
      headline: `发现 ${rows.length} 项周期订阅 · 年化约 ¥${fmtYuan(totalYear)}`,
      narrative: narrativeParts.join(""),
      confidence: 0.88,
      significance: `订阅商户 ${rows.length} 个 · 年化 ¥${fmtYuan(totalYear)}`,
      evidence: {
        chart: {
          tableId: "subscription_patterns",
          chartType: "bar",
          title: "订阅项扣款笔数",
          dimField: "merchant",
          measureFields: ["n"],
        },
        stats: [
          { label: "订阅项数", value: String(rows.length) },
          { label: "年化合计", value: fmtYuan(totalYear), unit: "元" },
          { label: "占支出比", value: `${sharePct}%` },
        ],
      },
      sources: [sqlCitation("table", "subscription_patterns"), ruleCitation("subscription-cycle-v1")],
    });

    // 卡 2：最大订阅项明细
    const topCount = numAt(top, 1);
    const topAvg = numAt(top, 2);
    const topInterval = numAt(top, 3);
    const topMonths = numAt(top, 4);

    // 附带的 RAG 案例引用：浏览器内 TF-IDF 在同族案例里检索（零网络，04 §1 模式 A），
    // 分数过 TFIDF_CITE_MIN 门槛才引用（宁缺毋滥，04 §4.6），不达标则不挂引用
    const ragRefs: CitationInput[] = [];
    const subscriptionPool = CASES.filter((c) => c.category === "subscription_trap");
    const ragHit = tfidfSearch(
      `${topMerchant} 自动续费 连续包月`,
      subscriptionPool,
      tfidfManifest as TfidfManifest,
      1,
    )[0];
    if (ragHit && ragHit.score >= TFIDF_CITE_MIN) {
      ragRefs.push(ragCitation(ragHit.case.id));
    }
    inputs.push({
      cardId: makeCardId("subscription", 2),
      headline: `最大订阅：${topMerchant} · 月均 ¥${fmtYuan(topAvg)}`,
      narrative:
        `${topMerchant} 近 12 个月共扣款 ${topCount} 笔，单笔均值 ¥${fmtYuan(topAvg)}，` +
        `平均间隔 ${topInterval.toFixed(0)} 天，持续 ${topMonths} 个月，符合自动续费特征。` +
        `若该项已不再使用，建议优先取消。`,
      confidence: 0.85,
      significance: `${topMerchant} 扣款 ${topCount} 笔 · 月均 ¥${fmtYuan(topAvg)}`,
      evidence: {
        chart: {
          tableId: "subscription_patterns",
          chartType: "bar",
          title: "最大订阅项",
          dimField: "merchant",
          measureFields: ["avg_cents"],
        },
        stats: [
          { label: "扣款笔数", value: String(topCount) },
          { label: "单笔均值", value: fmtYuan(topAvg), unit: "元" },
          { label: "平均间隔", value: `${topInterval.toFixed(0)} 天` },
        ],
      },
      sources: [
        sqlCitation("table", "subscription_patterns"),
        ruleCitation("subscription-cycle-v1"),
        ...ragRefs,
      ],
    });

    return inputs;
  },
};
