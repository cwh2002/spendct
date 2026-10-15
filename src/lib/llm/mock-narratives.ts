/**
 * mock 叙事模板库（T6 LLM 接入层，零密钥剧本演示的唯一文本来源）。
 *
 * 设计口径：
 * - 文本按「task × 档位」组织，每档 2-3 段、每段 80-200 字（quick-entry 档为示例句，不受字数约束）；
 * - 段落里用 {占位} 写数字，运行时经 fillTemplate 填充，保证演示数据可复现（01 §7-6 录制口径）；
 * - 语感对齐财经编辑的账单点评：只讲数字支持的事实，不用「综上所述/值得注意的是/首先/其次」类套话；
 * - 本文件是纯函数 + 数据，无任何服务端依赖，可在单测与客户端安全引用。
 */

/** LLM 任务枚举（08 修订案 A5 的 5 个扩展任务 + 六阶段叙事 + 追问对话 chat +
 *  思考计划 assistant-plan（08 修订案 A12），全项目唯一来源） */
export const LLM_TASKS = [
  "narrative",
  "budget-advice",
  "forecast-narrative",
  "quick-entry",
  "annual-story",
  "tip-personalize",
  "chat",
  "assistant-plan",
] as const;

export type LlmTask = (typeof LLM_TASKS)[number];

/** mock 文本总表：task → 档位 → 段落。narrative 的档位 = 六阶段 StageId（07 §1） */
export const MOCK_NARRATIVES: Record<LlmTask, Record<string, string[]>> = {
  narrative: {
    clean: [
      "本次账单共解析 {rows} 笔交易，微信 {wechat} 笔、支付宝 {alipay} 笔，全部统一换算成整数分口径。清理掉 {dup} 笔疑似重复记录和 {skip} 行格式异常数据后，实际入账 {valid} 笔，合计金额与原始文件核对一致。",
      "其中 {refund} 笔退款按原支出方向回冲，没有混进收入。商户名称保留原始写法，暂时归「其他」的类目会在画像阶段按商户词典重新细分，这一步只做减法：不改金额、不合并不同商户的记录。",
      "如果对某笔金额存疑，先回原平台翻单号比对。清洗阶段不产生新的误差，也不删除真实消费；它做的事只有两件——把重复项并掉，把格式坏的行剔除，每一处剔除都单独报告出来，方便你回原文件核对。",
    ],
    profile: [
      "这 {months} 个月里，{cat} 占总支出的 {pct}%，月均 {catm} 元，是花钱最多的类目。其中外卖占 {takeout}%、堂食 {dine}%；周五和周末的餐饮支出比工作日均值高 {weekend}%，周末集中消费的特征轻微但稳定。",
      "购物月均 {shop} 元、娱乐月均 {fun} 元，分列第二、第三。交通月均 {traffic} 元，地铁公交占 {subway}%，波动主要来自打车；购物集中在月初和电商大促前后，节奏基本可预期。",
      "支出时段集中在 12 点和 18 点前后，深夜（23:00-05:00）占比 {night}%，属于偶发。一句话画像：吃饭是大头，通勤很固定，深夜消费不多，你的消费结构比多数人更可预测。",
    ],
    anomaly: [
      "这 {months} 个月抓出 {count} 笔深夜消费（23:00-05:00），合计 {nightAmount} 元，集中在深夜外卖、游戏充值和直播打赏，周末熬夜的连带消费是主因。",
      "冲动消费检测到 {impulse} 笔：下单间隔短、单笔金额明显偏离你的同类均值，最大一笔 {max} 元。它们没有对错，只是大多发生在情绪高点，回看时容易记不起来当时为什么买。",
      "退款异常 {refund} 笔已全部按原方向冲回，没有多算支出。深夜消费里如果有你不记得的订单，建议抽空回原平台核对一遍——现在花五分钟，比月底对着账单发懵省事得多。",
    ],
    subscription: [
      "按同商户 {n} 笔、金额恒定的口径扫描，找出 {count} 项疑似连续订阅，合计 {sub} 元/年。最大的一项每月扣 {monthly} 元，已经连续扣了 {months} 个月，中途从没断过。",
      "其中 {unused} 项最近 {days} 天没有使用痕迹，是典型的「免费试用转自动续费」。取消入口一般藏在会员页的「管理订阅」里，平台不会主动提醒，扣费前才发一条容易漏看的短信。",
      "这 {count} 项里只有 {used} 项是你主动按月续的。按当前节奏，订阅类固定支出占总消费的 {subPct}%，一年下来接近 {sub} 元，建议逐项点开核对续费的必要性。",
    ],
    attribution: [
      "本月总支出环比 {mom}%，变动主要来自 {cat}：单月涨了 {momAmount} 元，贡献了全部增量的 {pct}%。其中 {merchant} 一家就多了 {m} 元，是这类目里最大的单项来源。",
      "对冲项是 {down}，环比降了 {d} 元。扣掉这一涨一跌，其余类目基本走平，说明消费结构没有变化，只是个别类目出现了集中消费，属于月度噪声，不是趋势性的改变。",
      "下个月值得盯的是 {cat}：如果它回落，月支出大概率回到 {base} 元上下的常态区间；如果继续走高，就值得单独翻一遍这类目的明细，看看是频次涨了还是单价涨了。",
    ],
    annual: [
      "全年 {rows} 笔支出合计 {yearTotal} 元，月均 {amount} 元。最大类目 {cat} 占 {pct}%；订阅类固定支出 {sub} 元，相当于每月自动划走 {subm} 元，这是账单里最容易被忽略的一层。",
      "支出最高点在 {month} 月、最低点在 {low} 月，两者相差 {gap} 元。下半年整体比上半年高 {h}%，主要被 {cat} 拉动，其余类目全年的波动都在正常范围内，没有明显拐点。",
      "从年度视角看，你有 {n} 个稳定消费习惯和 {sporadic} 个偶发项目。稳定项适合做成预算模板照跑，偶发项适合在付款前多停三秒——年度账单的价值不在翻旧账，而在给明年定锚点。",
    ],
  },
  "budget-advice": {
    ok: [
      "餐饮预算用了 {pct}%，节奏健康。剩余 {rest} 元要覆盖未来 {days} 天，日均 {daily} 元以内都不会超，这个额度比你的近三个月日均 {avg} 元宽松不少，正常吃没问题。",
      "没有需要调整的项目。下个月可以把餐饮预算按近三个月均值 {avg} 元微调，避免某个月聚餐多就整体放大预算——预算基准应该跟常态走，而不是跟着噪声走，这样预算才会越用越准。",
      "如果这个月还有大的聚会计划，提前在预算页看一眼进度就行，不需要临时改数。真超了再动预算，比提前放松额度更不容易滑向失控——大多数月份，你现在这个数都够用，进度条比感觉可靠。",
    ],
    warn: [
      "餐饮已用 {pct}%，过了 80% 警戒线。剩余 {rest} 元要撑未来 {days} 天，日均 {daily} 元，比你近三个月日均 {avg} 元要紧一些，外卖频次得收一收。",
      "超支压力集中在 {cat} 单项，其余类目都在安全区。建议先不调预算，把接下来几天的大额计划挪到下周，多数情况下月底前能自然回稳，不用一上来就改预算，改得太勤反而失去参考价值。",
      "如果本月有一次聚餐垫高了进度，把它标记为一次性支出即可，别让它带偏下个月的预算基准。预算追的是常态，不是某一个特殊月份，月底对账时按这个口径看，数字才更准，也少很多自我较劲。",
    ],
    over: [
      "餐饮预算已用 {pct}%，超支 {over} 元。剩下 {days} 天想守住原额度，日均只能花 {daily} 元，低于你的日常水平，硬压不现实，也容易报复性反弹。",
      "建议两步走：先把预算调到 {suggest} 元（近三个月最高值），再决定超出的 {over} 元是从下月补回，还是认作本月一次性超支。前者适合想长期控量，后者适合临时状况。",
      "如果本月有搬家、节日这类大额项，直接把它们单列出去，剩下的日常消费其实没有失控。预算超了不代表习惯崩了，先分清是计划内还是计划外，再决定动不动预算，别急着全盘推翻。",
    ],
  },
  "forecast-narrative": {
    up: [
      "按近三个月走势，{cat} 下月预计环比 {pct}%。近三月月支出逐月走高，最后一个月 {last} 元，比首月 {first} 元高 {gap} 元，趋势由消费频次和单价共同推高。",
      "这是朴素外推，不包含你下月的计划变更。如果下月有明确省钱打算，实际值大概率低于预测；若赶上大促或出行，则可能高于预测——两个方向都别太当真，当个量级参考就行，别为它提前调整预算。",
    ],
    down: [
      "按近三个月走势，{cat} 下月预计环比 {pct}%。月支出逐月回落，最后一个月 {last} 元，已低于首月 {first} 元，回落主要来自 {reason} 类支出收缩。",
      "按这个斜率外推，下月总支出预计落在 {low} 到 {high} 元区间。回落的可持续性取决于收缩项是否反弹，前两个月已经验证过一次，可信度比单月数据要高一些。",
    ],
    flat: [
      "近三个月 {cat} 在 {low} 到 {high} 元之间窄幅波动，没有明显方向，下月预计继续走平，环比在 {pct}% 以内。波动主要来自偶发单笔，日常部分非常稳定。",
      "这种走势下预算不需要调整，按当前均值 {avg} 元设置即可。预测走平意味着变动风险低，把注意力留给订阅续费和深夜消费那两块，比盯着下月数字更有实际回报，也更省心。",
    ],
  },
  "quick-entry": {
    example: [
      "中午食堂花了 15",
      "昨天地铁 4 块",
      "收到红包 200",
      "奶茶 16 元",
      "自动续费会员扣了 25",
    ],
  },
  "annual-story": {
    default: [
      "年度总览：{rows} 笔支出合计 {amount} 元，月均 {monthly} 元。餐饮以 {pct}% 的占比稳坐第一，堂食与食堂撑起日常基本盘，外卖打辅助，整体结构清晰、没有跑偏的类目。",
      "最烧钱类别：{cat} 全年 {catm} 元，其中 {merchant} 贡献了 {mpct}%。你的饮食结构稳定，支出增长主要来自单价和频次的同步上升，而不是某一次报复性消费。",
      "订阅刺客：{n} 项自动续费合计 {sub} 元/年，深夜消费 {night} 元、以游戏充值与直播为主。明年一句话：把订阅审一遍，吃饭留好预算，其余保持现在的节奏，不用大动。",
    ],
  },
  "tip-personalize": {
    default: [
      "从你的画像看，外卖占餐饮 {pct}%、堂食为主，这几条贴士优先围绕「食堂为主、外卖为辅」来选，每条都附了为什么适合你的理由，而不是通用清单。你可以按顺序往下看，第一条见效最快。",
      "深夜消费 {count} 笔全年只占 {night}%，金额不大但频次稳定，对应的省钱案例排在前面。这类消费改起来阻力最小——改的是下单时机，不是生活方式，不用克制口腹之欲，成功率反而最高，值得先试。",
      "订阅类固定支出适合从年付切换入手，一次操作管一年，比每天省三块五块更有积累感。三条贴士按「省得多、改得动、见效快」排序，你可以先只试第一条，一周后再回来看效果就行。",
    ],
  },
  /**
   * chat（追问对话）兜底档位口径：
   * 追问面板提交流程里，本地规则答得了的问题不会走到本任务；只有规则判定需要在线
   * 服务、而在线服务恰好不可用（或 mock 模式误达）时才会回落到这段文案。因此文案
   * 只做两件事——说明当前为什么答不了，并给出 3 个本地可直接回答的示例问句，把用户
   * 引导回不依赖联网的路径。全段不含占位符与任何数字，保证 mock 流逐字可复现。
   */
  chat: {
    default: [
      "当前没有连接在线服务，这条兜底路径通常不会被触发；如果走到了这里，说明刚才的问题暂时没有现成答案。不过大部分账单问题都能直接读取你本地导入的账单数据来回答，不依赖联网；本地答不了的问题，连接在线服务后会带上账单汇总统计与最近明细给大模型分析。",
      "你可以先换一种问法，比如：「这个月花了多少」「这个月餐饮花了多少」「这个月结余多少」。这类问题由本地统计直接回答，给出的每个数字都来自你导入的账单，可以随时回账单里核对。",
    ],
    /**
     * promo（MCP 工具演示档）：DEMO_MODE=mock 下，问题命中大促关键词时
     * 走这条脚本化演示流——/api/followup 先发射 get_promo_calendar 的
     * tool:start/tool:end 事件（徽章数据源），再逐片推送本段文案。
     * 数字与大促日历数据文件（mcp-server/src/data/promo-calendar-2026.json）
     * 逐字一致，保证演示口径可复现。
     */
    promo: [
      "大促日历显示：双11 预热期 10 月 20 日开始，正式期 11 月 1 日到 11 日，返场到 11 月 18 日；淘宝、京东、拼多多、抖音四个平台都有档期。",
      "对照你的账单，购物类消费集中在月初和大促前后，数码和日百是双11 的主力品类。建议 10 月 20 号预热期先加购比价，正式期再下单；返场期力度会打折，适合补漏，不适合囤货。",
    ],
  },
  /**
   * assistant-plan（思考计划，08 修订案 A12）档位口径：
   * 数组固定为 [目标, 步骤1, 步骤2, ...]——首元素是 goal，其余是步骤标题。
   * 本任务不走 pickMockText（结构化计划由 mockAssistantPlan 读取本表组装，
   * 再经 /api/followup 发射 plan 事件）；表项只为保持 Record<LlmTask, …>
   * 完整与文案单一来源。promo 档与大促演示流联动，第一步的工具名与
   * get_promo_calendar 徽章同名。
   */
  "assistant-plan": {
    default: [
      "基于账单数据回答消费问题",
      "汇总账单统计与最近明细",
      "按问题口径组织回答",
    ],
    promo: [
      "围绕大促问题给出消费规划",
      "查询大促日历确认档期与平台",
      "对照账单统计评估购物节奏",
      "结合预算给出比价与囤货建议",
    ],
  },
};

/** 各任务 mock 默认数字（与 src/lib/demo-data.ts 的内置账单口径一致，录制可复现） */
export const DEFAULT_MOCK_VARS: Record<LlmTask, Record<string, string | number>> = {
  narrative: {
    rows: 793,
    wechat: 370,
    alipay: 407,
    dup: 2,
    skip: 0,
    valid: 791,
    refund: 2,
    months: 12,
    cat: "餐饮",
    pct: 41,
    amount: 1733,
    catm: 709,
    takeout: 22,
    dine: 78,
    weekend: 5,
    shop: 279,
    fun: 163,
    traffic: 108,
    subway: 45,
    night: 1.7,
    count: 23,
    nightAmount: 350,
    impulse: 6,
    max: 450,
    n: 3,
    sub: 660,
    monthly: 25,
    unused: 1,
    days: 90,
    used: 2,
    subPct: 3.2,
    mom: "+23.2",
    momAmount: 407,
    merchant: "名创优品",
    m: 176,
    down: "娱乐",
    d: 298,
    base: 1733,
    yearTotal: "20,800",
    subm: 55,
    month: "9",
    low: "7",
    gap: 771,
    h: "10.9",
    sporadic: 6,
  },
  "budget-advice": {
    pct: 62,
    rest: 296,
    days: 9,
    daily: 33,
    avg: 24,
    cat: "外卖",
    over: 109,
    suggest: 771,
  },
  "forecast-narrative": {
    cat: "总支出",
    pct: "+23",
    last: 2158,
    first: 1387,
    gap: 771,
    reason: "开学季采购",
    low: 1680,
    high: 2158,
    avg: 1733,
  },
  "quick-entry": {},
  "annual-story": {
    rows: 793,
    amount: "20,800",
    monthly: 1733,
    pct: 41,
    cat: "餐饮",
    catm: 8507,
    merchant: "学校食堂",
    mpct: "13",
    n: 3,
    sub: 660,
    night: 350,
  },
  "tip-personalize": {
    pct: 22,
    sub: 660,
    count: 23,
    night: 1.7,
  },
  // chat 兜底文案不含占位符，变量表留空即可（pickMockText 对空表按原文输出）
  chat: {},
  // assistant-plan 为结构化计划（mockAssistantPlan 直接读叙事表），无变量
  "assistant-plan": {},
};

/** forecast 三档各自的气象数字（涨/跌/平的幅度与区间不能共用一套） */
const FORECAST_TREND_VARS: Record<"up" | "down" | "flat", Record<string, string | number>> = {
  up: {
    cat: "总支出",
    pct: "+23",
    last: 2158,
    first: 1387,
    gap: 771,
    reason: "开学季采购",
    low: 1680,
    high: 2158,
    avg: 1733,
  },
  down: {
    cat: "总支出",
    pct: "-6",
    last: 1702,
    first: 1818,
    gap: 116,
    reason: "娱乐",
    low: 1680,
    high: 1760,
    avg: 1720,
  },
  flat: {
    cat: "总支出",
    pct: "±3",
    last: 1668,
    first: 1741,
    gap: 73,
    reason: "外卖",
    low: 1650,
    high: 1741,
    avg: 1686,
  },
};

const BUDGET_HEADLINES: Record<"ok" | "warn" | "over", string> = {
  ok: "预算已用 {pct}%，节奏健康，不用调整",
  warn: "预算已用 {pct}%，临近警戒线",
  over: "预算已用 {pct}%，已经超支",
};

const FORECAST_HEADLINES: Record<"up" | "down" | "flat", string> = {
  up: "{cat} 下月预计环比 {pct}%，延续走高",
  down: "{cat} 下月预计环比 {pct}%，继续回落",
  flat: "下月支出预计走平，环比波动 {pct}% 以内",
};

/** 贴士适配理由（≤40 字，schema 约束见 08 §⑥.4） */
const TIP_WHY_TEMPLATES = [
  "外卖占你餐饮的 {pct}%，先凑满减再下单",
  "你周末深夜点单多，改成周五白天囤货",
  "你有多项自动续费，年付切换一年省 {sub} 元",
];

/** 用 vars 替换模板中的 {占位}；未提供的占位保持原样，方便调用方发现缺数 */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** 按 task（+档位）取确定性 mock 文本：段落拼接后填充默认数字 */
export function pickMockText(task: LlmTask, stage?: string): string {
  const entries = MOCK_NARRATIVES[task];
  const firstKey = Object.keys(entries)[0] ?? "";
  const key =
    stage !== undefined && entries[stage] !== undefined
      ? stage
      : entries.default !== undefined
        ? "default"
        : firstKey;
  const segments = entries[key] ?? [];
  const vars = DEFAULT_MOCK_VARS[task] ?? {};
  return segments.map((segment) => fillTemplate(segment, vars)).join("\n\n");
}

export interface MockPlan {
  goal: string;
  steps: Array<{ title: string; tool?: string }>;
}

/**
 * 思考计划 mock（08 修订案 A12）：读取叙事表 assistant-plan 档
 * （[目标, 步骤1, …] 布局）组装结构化计划；promo 档第一步挂
 * get_promo_calendar 工具名，与工具徽章联动演示「计划 → 调用」闭环。
 */
export function mockAssistantPlan(promo: boolean): MockPlan {
  const rows = MOCK_NARRATIVES["assistant-plan"][promo ? "promo" : "default"] ?? [];
  const [goal = "", ...stepTitles] = rows;
  return {
    goal,
    steps: stepTitles.map((title, index) => ({
      title,
      ...(promo && index === 0 ? { tool: "get_promo_calendar" } : {}),
    })),
  };
}

export interface MockBudgetAdvice {
  severity: "ok" | "warn" | "over";
  headline: string;
  advice: string;
  actions: ("adjust_budget" | "view_detail" | "dismiss")[];
}

/** 预算建议 mock：severity 由 ratio 阈值直接判定（08 §⑥.2 模板兜底口径），文案取对应档首段 */
export function mockBudgetAdvice(ratio?: number): MockBudgetAdvice {
  const severity = ratio === undefined ? "ok" : ratio < 0.8 ? "ok" : ratio < 1 ? "warn" : "over";
  const pct = Math.round((ratio ?? 0.62) * 100);
  const vars = { ...DEFAULT_MOCK_VARS["budget-advice"], pct };
  const segment = MOCK_NARRATIVES["budget-advice"][severity]?.[0] ?? "";
  return {
    severity,
    headline: fillTemplate(BUDGET_HEADLINES[severity], vars),
    advice: fillTemplate(segment, vars),
    actions:
      severity === "ok"
        ? []
        : severity === "warn"
          ? ["view_detail"]
          : ["adjust_budget", "view_detail"],
  };
}

export interface MockForecastNarrative {
  headline: string;
  narrative: string;
  disclaimer: string;
}

/** 预测叙事 mock：按涨/跌/平三档取模板，disclaimer 保留 08 §⑥.3 原文 */
export function mockForecastNarrative(trend?: "up" | "down" | "flat"): MockForecastNarrative {
  const key: "up" | "down" | "flat" = trend ?? "up";
  const vars = FORECAST_TREND_VARS[key];
  return {
    headline: fillTemplate(FORECAST_HEADLINES[key], vars),
    narrative: (MOCK_NARRATIVES["forecast-narrative"][key] ?? [])
      .map((segment) => fillTemplate(segment, vars))
      .join("\n\n"),
    disclaimer: "朴素季节外推，仅作参考，不构成建议",
  };
}

export interface MockTip {
  caseId: string;
  why: string;
}

/** 贴士个性化 mock：caseId 只允许来自调用方传入的列表（防编造引用），缺省用演示占位 id */
export function mockTips(caseIds: readonly string[]): { tips: MockTip[] } {
  const ids =
    caseIds.length >= 3 ? caseIds.slice(0, 3) : ["case-demo-1", "case-demo-2", "case-demo-3"];
  const vars = DEFAULT_MOCK_VARS["tip-personalize"];
  return {
    tips: ids.map((caseId, index) => ({
      caseId,
      why: fillTemplate(TIP_WHY_TEMPLATES[index] ?? TIP_WHY_TEMPLATES[0] ?? "", vars),
    })),
  };
}
