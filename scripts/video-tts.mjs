/**
 * 演示视频旁白合成驱动。
 *
 * 每个分镜的旁白文本（docs/demo-script.md 口播稿）落盘为 UTF-8 文本后交给
 * video-tts.ps1 用 Windows 内置语音合成 WAV（PCM 单声道），再解析 RIFF 头
 * 读出实际时长，汇总写入 timings.json 供录屏与混流脚本排期。
 *
 * 用法：node scripts/video-tts.mjs
 * 产物：scripts/.video/audio/*.wav + timings.json（不入库，见 .gitignore）
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = `${fileURLToPath(new URL(".", import.meta.url))}.video/`;
const AUDIO_DIR = `${VIDEO_DIR}audio/`;
mkdirSync(AUDIO_DIR, { recursive: true });

const PS1 = `${fileURLToPath(new URL(".", import.meta.url))}video-tts.ps1`;

/**
 * 分镜旁白（对应 demo-script.md 的 S1–S8；数字按 11/13 终测数据）。
 * 文本只保留朗读所需标点：顿号换逗号、破折号换句号停顿，避免语音引擎
 * 读出符号本身；英文缩写按字母朗读，与口播一致。
 */
const SCENES = [
  {
    id: "s1",
    text:
      "大家好，我们的作品是 SpendCT，AI 账单体检与消费洞察平台。开讲前请记住两件事。第一：AI 先体检、你来审阅追问，它给你的不是聊天，是带证据的报告。第二：你的账单永远不出浏览器，大模型只看到聚合摘要，服务器只见转发。接下来用一条真实动线演示。",
  },
  {
    id: "s2",
    text:
      "第一步，数据。支持微信、支付宝导出的 CSV，也支持账单截图 OCR。没有真实账单也没关系，内置一千行脱敏演示账单，一键加载。看到格式嗅探结果：字段映射置信度、去重移除的行数，全都摊开给你看。",
  },
  {
    id: "s3",
    text:
      "第二步，体检。清洗、画像、异常、订阅陷阱、环比归因、年度报告，六阶段全自动，每一步你都能看见它在想什么：正在执行的 SQL、命中行数、引用的案例。点开任意阶段卡，该阶段执行的 SQL、命中数、耗时、产出卡都在这里。跑了一半可以暂停、续跑，状态存在本机。",
  },
  {
    id: "s4",
    text:
      "产出不是闲聊，是报告。每张卡都有结论、证据图表、置信度、来源引用。你可以确认它、质疑它、收藏它，低置信度的结论会被系统自动挂起，等你人工复核。",
  },
  {
    id: "s45",
    text:
      "账本不只一张表。日历热力图看消费节奏，桑基图看钱流向哪里，图上任何元素都能点了追问。卡片流、图表廊随意切。订阅管理墙告诉你：下一次扣费什么时候来，取消按钮藏在哪。",
  },
  {
    id: "s5",
    text:
      "图上任何元素都能点了追问。深挖把这张卡钉进追问面板，带上它的上下文。每一次提问，面板都展示执行计划：意图识别、生成脱敏 SQL 并本地执行、最后汇总成结论，每一步都有据可查。",
  },
  {
    id: "s55",
    text:
      "懒得记账？说一句话就入账。确认卡上的金额、类目、时间是结构化输出的结果，不是模板匹配。预算中心里，超支了会有贴士提醒你接下来几天该花多少，下月支出还有预测。",
  },
  {
    id: "s6",
    text:
      "账单是数据，不是指令。我们把恶意提示词直接塞进商户名，系统照常出报告，叙事里没有一句被带偏。三层防护加输出校验闸门，恶意注入在这里失效。",
  },
  {
    id: "s7",
    text:
      "最后是真实数字。一万行账单清洗加聚合，四百五十六毫秒；WASM 冷加载八百七十四毫秒，热加载七百八十四毫秒；十万行导入，六百五十七毫秒；内存峰值十点一兆字节。六阶段全确定性路径，不依赖任何大模型调用。RAG 金标评测，命中十中十；恶意 SQL 拦截，十中十。全程零嵌入 API 请求。",
  },
  {
    id: "s8",
    text: "再记一遍这两句话：AI 先体检，你审阅追问；账单不出浏览器。账单体检，不止六项。SpendCT，谢谢大家。",
  },
];

/** 解析 PCM WAV 的 RIFF 头得到毫秒时长（System.Speech 输出 16bit 单声道） */
function wavDurationMs(wavPath) {
  const buf = readFileSync(wavPath);
  const sampleRate = buf.readUInt32LE(24);
  const channels = buf.readUInt16LE(22);
  const bitsPerSample = buf.readUInt16LE(34);
  // 字节 36 起为标准 16 字节 fmt 块的 data 声明；保险起见按标记扫描
  let dataSize = 0;
  for (let pos = 12; pos + 8 <= buf.length; ) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "data") {
      dataSize = size;
      break;
    }
    pos += 8 + size + (size % 2);
  }
  return Math.round((dataSize / (sampleRate * channels * (bitsPerSample / 8))) * 1000);
}

const timings = {};
for (const scene of SCENES) {
  const txt = `${AUDIO_DIR}${scene.id}.txt`;
  const wav = `${AUDIO_DIR}${scene.id}.wav`;
  // BOM 保证 PowerShell 按 UTF-8 读取中文
  writeFileSync(txt, `﻿${scene.text}`, "utf8");
  execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, "-In", txt, "-Out", wav, "-Rate", "-2"],
    { stdio: "inherit" },
  );
  const durationMs = wavDurationMs(wav);
  timings[scene.id] = { text: scene.text, wav: `${scene.id}.wav`, durationMs };
  console.log(`✓ ${scene.id}: ${(durationMs / 1000).toFixed(2)}s（${scene.text.length} 字）`);
}

writeFileSync(`${AUDIO_DIR}timings.json`, `${JSON.stringify(timings, null, 2)}\n`, "utf8");
const total = Object.values(timings).reduce((sum, t) => sum + t.durationMs, 0);
console.log(`旁白合计 ${(total / 1000).toFixed(1)}s → ${AUDIO_DIR}timings.json`);
