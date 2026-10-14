/**
 * 账单文件「字节流 → 文本」的编码探测链（07 契约 §9 唯一口径）：
 * UTF-8 严格解码 → GB18030（GBK 的超集）→ GBK；全部失败抛错，由调用方转 PARSE_FAILED。
 *
 * 浏览器 TextDecoder 原生支持这三种编码，无需第三方依赖；解码后的文本统一交给
 * parse-csv 的 PapaParse 做结构化（PapaParse 不支持 GBK/GB18030）。
 * 解码后若仍有乱码痕迹（如被二次转码的脏文件），由 parse-csv 的乱码嗅探给出
 * 「另存为 UTF-8」提示，本模块不处理。
 */

/** 探测顺序：与 07 契约 §9 保持逐字一致 */
const PROBE_ENCODINGS = ["utf-8", "gb18030", "gbk"] as const;

export function decodeBillFile(buffer: ArrayBuffer): string {
  let lastError: unknown = null;
  for (const encoding of PROBE_ENCODINGS) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    "无法识别账单文件的文字编码（UTF-8 / GB18030 / GBK 均解码失败），请确认导出的是微信/支付宝账单 CSV",
    { cause: lastError },
  );
}
