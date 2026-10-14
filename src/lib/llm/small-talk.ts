/**
 * 闲聊意图分流：追问面板与快速记账共用同一套口语词表口径。
 *
 * 用户在追问面板输入「你好」「你是谁」这类非账单问题时，若仍按账单问题
 * 给出锚点回答，会显得答非所问；本模块先按「询问身份 > 打招呼」的顺序
 * 分流，命中即用定稿文案直接回答，未命中（账单类问题）才走既有锚点流程。
 * 快速记账侧沿用同一份关键词口径，把闲聊输入挡在金额解析之前。
 *
 * 只含纯函数与常量、无服务端依赖，可在客户端组件直接引用。
 */

/** 闲聊意图：打招呼 或 询问身份 */
export type SmallTalkKind = "greeting" | "identity";

/** 打招呼关键词：命中即按问候文案回复 */
const GREETING_WORDS: readonly string[] = [
  "你好",
  "您好",
  "嗨",
  "哈喽",
  "在吗",
  "在不在",
  "hi",
  "hello",
];

/** 询问身份关键词：优先级高于打招呼，先查本表再查打招呼表 */
const IDENTITY_WORDS: readonly string[] = [
  "你是谁",
  "你是什么",
  "你是啥",
  "你是哪个",
  "你叫",
  "什么模型",
  "什么大模型",
  "大模型",
  "模型",
  "你的名字",
  "叫什么",
  "名字",
  "身份",
  "机器人",
  "真人",
  "人工智能",
  "自我介绍",
  "介绍一下你",
  "介绍一下自己",
  "chatgpt",
  "gpt",
  "ai",
];

/**
 * 关键词命中判定：拉丁词按整词边界匹配（"hi" 不误伤 "this"、"gpt" 不误伤 "chatgpt"），
 * 中文词直接子串匹配。
 */
function containsWord(text: string, word: string): boolean {
  if (/[a-z]/i.test(word)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  }
  return text.includes(word);
}

/**
 * 闲聊意图分类：身份 > 打招呼 > null。
 * null 表示账单类问题，由调用方按既有锚点流程处理。
 */
export function classifySmallTalk(text: string): SmallTalkKind | null {
  if (IDENTITY_WORDS.some((word) => containsWord(text, word))) return "identity";
  if (GREETING_WORDS.some((word) => containsWord(text, word))) return "greeting";
  return null;
}

/** 两类闲聊的定稿回答文案 */
export const SMALL_TALK_ANSWER: Record<SmallTalkKind, string> = {
  greeting:
    "你好！我是账单助手，可以围绕你的账单数据回答问题。点洞察卡上的「深挖」就能继续追问，也可以直接输入问题，比如「外卖为什么涨了？」",
  identity:
    "我没有固定的模型身份：未连接在线服务时，账单问题由产品内置的规则直接回答；在设置里连接在线服务后，回答会交给外部大模型生成。两种方式都只围绕你的账单说话，不编造数据。",
};
