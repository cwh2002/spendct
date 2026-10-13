/**
 * 演示视频混流脚本。
 *
 * 输入：record-demo-video.mjs 产出的分段 webm（scripts/.video/segments/）
 * 与旁白 WAV（scripts/.video/audio/，timings.json 记时长），
 * moments.json 记录各分镜在段内的开镜偏移。
 *
 * 流程：
 *   1) 每段 webm 统一转码 H.264/AAC MP4（yuv420p，保证拼接同参数）；
 *   2) concat demuxer 拼接五段 → 全片视频轨；
 *   3) 各旁白按「段起点 + 镜内偏移」铺到全局时间轴（adelay），
 *      amix 混合后 apad 补齐到视频时长 → 与视频轨合流。
 *
 * ffmpeg 使用 imageio-ffmpeg 自带二进制（无系统依赖）。
 * 产物：scripts/.video/SpendCT-演示视频.mp4（不入库，见 .gitignore）
 */
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = `${fileURLToPath(new URL(".", import.meta.url))}.video/`;
const SEG_DIR = `${VIDEO_DIR}segments/`;
const AUDIO_DIR = `${VIDEO_DIR}audio/`;
const OUT = `${VIDEO_DIR}SpendCT-演示视频.mp4`;

const FFMPEG = "D:/py2024/py/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe";
const moments = JSON.parse(readFileSync(`${VIDEO_DIR}moments.json`, "utf8"));
const timings = JSON.parse(readFileSync(`${AUDIO_DIR}timings.json`, "utf8"));

const ffmpeg = (args) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// ── 1) 分段转码：统一 H.264/AAC 参数，concat 前参数一致 ───────────
const MP4 = moments.segments.map((s) => `${s.id}.mp4`);
for (const s of moments.segments) {
  console.log(`转码 ${s.file}（${(s.durationMs / 1000).toFixed(1)}s）…`);
  ffmpeg([
    "-i", `${SEG_DIR}${s.file}`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-pix_fmt", "yuv420p", "-r", "30",
    "-an", // 分段视频无音轨（旁白后铺）
    `${SEG_DIR}${s.id}.mp4`,
  ]);
}

// ── 2) 拼接全片视频轨 ────────────────────────────────────────────
const concatList = `${VIDEO_DIR}concat.txt`;
writeFileSync(concatList, MP4.map((f) => `file '${SEG_DIR}${f}'`).join("\n"), "utf8");
console.log("拼接分段…");
ffmpeg(["-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", `${VIDEO_DIR}video-only.mp4`]);

// ── 3) 旁白铺时间轴：段起点（前段时长累计）+ 镜内偏移 ─────────────
const placements = [];
let segStartMs = 0;
for (const s of moments.segments) {
  for (const sc of s.scenes) {
    placements.push({ id: sc.id, atMs: segStartMs + sc.offsetMs, wav: `${AUDIO_DIR}${timings[sc.id].wav}` });
  }
  segStartMs += s.durationMs;
}

// 全片时长以拼接视频轨为准（execFileSync 不返回 stderr，用 -progress 读 stdout）
const probeOut = execFileSync(
  FFMPEG,
  ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-i", `${VIDEO_DIR}video-only.mp4`, "-f", "null", "-"],
  { encoding: "utf8" },
);
const outTimes = [...probeOut.matchAll(/out_time_ms=(\d+)/g)];
if (outTimes.length === 0) throw new Error("无法读取拼接后视频时长");
// ffmpeg -progress 的 out_time_ms 字段名带 ms、实际单位是微秒（已知行为），
// 除以 1e6 才是秒；此前按毫秒换算导致 apad 多铺出约一倍静音
const totalSec = Number(outTimes[outTimes.length - 1][1]) / 1_000_000;

const filterParts = [];
const inputs = ["-i", `${VIDEO_DIR}video-only.mp4`];
for (let i = 0; i < placements.length; i++) {
  const p = placements[i];
  inputs.push("-i", p.wav);
  filterParts.push(`[${i + 1}:a]adelay=${p.atMs}|${p.atMs}[a${i}]`);
}
const mixIns = placements.map((_, i) => `[a${i}]`).join("");
const filter = [
  ...filterParts,
  `${mixIns}amix=inputs=${placements.length}:normalize=0:duration=longest,apad=whole_dur=${Math.ceil(totalSec * 10) / 10}[aout]`,
].join(";");

console.log(`铺旁白 ${placements.length} 条（全片 ${totalSec.toFixed(1)}s）并合流…`);
ffmpeg([
  ...inputs,
  "-filter_complex", filter,
  "-map", "0:v", "-map", "[aout]",
  "-c:v", "copy",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-movflags", "+faststart",
  OUT,
]);

// ── 4) 校验 ──────────────────────────────────────────────────────
const finalProbe = execFileSync(
  FFMPEG,
  ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-i", OUT, "-map", "0", "-f", "null", "-"],
  { encoding: "utf8" },
);
const finalTimes = [...finalProbe.matchAll(/out_time_ms=(\d+)/g)];
// 与 totalSec 同源：-map 0 让 out_time 覆盖音视频两轨的末位时间，
// 若音频轨被误铺长，这里读出的时长会同步放大，直接暴露问题
const finalSec = Number(finalTimes[finalTimes.length - 1][1]) / 1_000_000;
const sizeMb = (readFileSync(OUT).length / 1024 / 1024).toFixed(1);
console.log(`\n✓ 成片：${OUT}`);
console.log(`  时长 ${Math.floor(finalSec / 60)}'${String(Math.round(finalSec % 60)).padStart(2, "0")}"，体积 ${sizeMb} MB`);

for (const f of ["video-only.mp4"]) unlinkSync(`${VIDEO_DIR}${f}`);

// ── 5) 逐镜验声：每镜开镜 1.5s 后抽 2s 音频，均值音量高于阈值即证明旁白落位 ──
const volLog = `${VIDEO_DIR}vol.log`;
let placedOk = 0;
for (const p of placements) {
  const fd = openSync(volLog, "w");
  execFileSync(
    FFMPEG,
    ["-hide_banner", "-loglevel", "info", "-ss", ((p.atMs + 1500) / 1000).toFixed(2), "-t", "2", "-i", OUT, "-af", "volumedetect", "-f", "null", "-"],
    { stdio: ["ignore", "ignore", fd] },
  );
  closeSync(fd);
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(readFileSync(volLog, "utf8"));
  const db = m ? Number(m[1]) : -Infinity;
  const ok = db > -55;
  if (ok) placedOk++;
  console.log(`  镜 ${p.id} @ ${(p.atMs / 1000).toFixed(1)}s：mean ${db.toFixed(1)} dB ${ok ? "✓" : "✗ 疑似静音"}`);
}
console.log(`旁白落位 ${placedOk}/${placements.length}`);
