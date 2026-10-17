/**
 * 账单问题信号（08 修订案 A18 热修复五轮）：案例路径的前置闸门。
 *
 * 案例路径只服务维权/攻略/政策类问题；账单分析类问法（时间窗/金额/
 * 类目/商户/账务实体）即使本地规则弃权（如「上上上个月」超出本地
 * 时间窗词表），也必须跳过案例检索直转在线兜底——否则会被 TF-IDF 的
 * 通用 bigram（「个月」「费用」）误中维权案例，用攻略回答账单问题。
 * A18 实测：「上上上个月花费多少费用」被《健身房年卡 3999 元，开业
 * 三个月就关门》抢答（得分 0.1698，仅差阈值 0.0198）。
 *
 * 复审修补（2026-10-17）：旧闸门把「出现花费词」当成进入账单判定的
 * 唯一前提，有两处偏斜——①「上上上个月费用是多少」这类无花费词的
 * 弃权月份问法漏判；②「三个月前健身房跑路，我花了三千办卡，怎么
 * 维权」这类维权叙事里的花费只是时间背景，旧闸门却按时间窗+花费词
 * 挡出案例路径。新闸门改为六档：先让「无问额词的维权叙事」无条件
 * 让位给案例库，再允许「弃权月份/时间窗/实体 + 金额词」在无花费词
 * 时也判为账单问法。金额词族刻意不含「元/块/钱」——维权叙事里的
 * 「花了三千块」只是金额背景，不是查询目标。
 *
 * 纯函数模块：只依赖 qa-engine 的 hasUnsupportedMonthPhrase（与本地
 * 弃权正则同源），不依赖 React/zustand/DuckDB，单测可直接 import。
 */
import { hasUnsupportedMonthPhrase } from "@/lib/chat/qa-engine";

/** 花费词族：进入账单判定的信号之一（「花了/花费/扣费」等动词与「多少钱」等问语） */
const SPEND_WORDS = [
  "花了",
  "花费",
  "支出",
  "开销",
  "消费",
  "用了",
  "花钱",
  "多少钱",
  "多少费用",
  "总额",
  "一共",
  "总共",
  "多少笔",
  "几笔",
  "扣费",
  "订阅",
] as const;

/** 时间窗词族（刻意不含「最近/近/个月」裸词——「开业三个月」类攻略问法不能误伤） */
const TIME_WORDS = [
  "这个月",
  "本月",
  "上个月",
  "上月",
  "上上个月",
  "上上月",
  "大上个月",
  "大上月",
  "今年",
  "全年",
  "整年",
  "去年",
] as const;

/** 类目/商户/账务实体词族（与花费词族合用，单独出现不触发） */
const ENTITY_WORDS = [
  "外卖",
  "打车",
  "餐饮",
  "购物",
  "交通",
  "娱乐",
  "订阅",
  "会员",
  "商户",
  "商家",
  "哪家",
  "哪店",
  "类目",
  "账单",
  "明细",
  "流水",
  "交易",
  "收入",
  "预算",
  "超支",
] as const;

/** 问额/计数词：维权叙事豁免判定的钥匙——叙事里有计数词才可能是在问账 */
const COUNT_WORDS = ["多少", "几笔", "哪些钱"] as const;

/**
 * 金额词族（问额词 + 计数词 + 账务名词）：账单问法的目标信号。
 * 刻意不含「元/块/钱」——「花了三千块办卡」的金额是维权叙事背景，
 * 不是查询目标，放进来会误伤案例路径。
 */
const MONEY_HINT_WORDS = [
  "多少",
  "多少钱",
  "几笔",
  "多少笔",
  "哪些钱",
  "费用",
  "开支",
  "账单",
  "金额",
  "花销",
] as const;

/** 维权/求助叙事词族：案例路径的服务对象，出现（且无问额词）即让位给案例库 */
const RIGHTS_HINT_WORDS = [
  "怎么办",
  "维权",
  "投诉",
  "索赔",
  "退货",
  "退款",
  "举报",
  "跑路",
  "关门",
  "被骗",
  "被坑",
  "骗",
] as const;

/** 花费词紧跟问额词（「消费总额多少」——整句没有时间窗也没有实体词） */
const SPEND_THEN_AMOUNT =
  /(花了|花费|支出|开销|消费|用了|花钱|总额|一共|总共).{0,4}(多少|多少钱|几笔)/;

/**
 * 判断问题是否为账单分析问法（案例路径应跳过、直转在线兜底）。
 * 六档判定（按序短路）：
 *   1. 无问额/计数词 + 有维权叙事词 → 否（让位案例库）；
 *   2. 弃权月份短语（上上上个月/前两个月/三个月前…）+ 金额词 → 是；
 *   3. 明确时间窗或账务实体 + 金额词 → 是（无花费词也可判，如「这个月账单多少」）；
 *   4. 无花费词族 → 否；
 *   5. 时间窗 / 账务实体 / 金额词任一 → 是；
 *   6. 花费词紧跟问额词 → 是（「消费总额多少」）。
 * 判定前先归一内部空白（「花 了多少」与「花了多少」等价）。
 */
export function isBillQuestion(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, "");
  const hasCount = COUNT_WORDS.some((word) => normalized.includes(word));
  const hasRights = RIGHTS_HINT_WORDS.some((word) => normalized.includes(word));
  const hasMoney = MONEY_HINT_WORDS.some((word) => normalized.includes(word));
  if (!hasCount && hasRights) return false;
  if (hasUnsupportedMonthPhrase(normalized) && hasMoney) return true;
  const hasTime = TIME_WORDS.some((word) => normalized.includes(word));
  const hasEntity = ENTITY_WORDS.some((word) => normalized.includes(word));
  if ((hasTime || hasEntity) && hasMoney) return true;
  if (!SPEND_WORDS.some((word) => normalized.includes(word))) return false;
  if (hasTime || hasEntity || hasMoney) return true;
  return SPEND_THEN_AMOUNT.test(normalized);
}
