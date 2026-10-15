/**
 * 客户端截图压缩（02 §12.1：最长边 ≤1600px、JPEG q0.85，产物一般 <800KB）。
 *
 * 压缩全程在浏览器内存完成（createImageBitmap + canvas.toBlob），
 * 不产生 ObjectURL、不落任何持久化存储；解码失败（非图片/格式不受支持）
 * 时原样回传文件，由服务端 5MB 上限兜底。
 */
export const MAX_IMAGE_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

/**
 * 压缩账单截图：等比缩放到最长边 ≤1600px，输出 JPEG Blob。
 * 任何一步失败都返回原文件（压缩是优化不是前置条件，02 §12.1）。
 */
export async function compressBillImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
      );
      return blob ?? file;
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

/**
 * 截取原图局部（02 §12.1「截取原图局部 → 二次复核」的客户端实现）：
 * 按行序在图片中的大致位置截出纵向条带（行序即图上从上到下）。
 * topRatio / bottomRatio 为 [0,1] 比例区间，由调用方按待复核行下标
 * 前后各扩一行算出；视觉模型不输出坐标框，条带截取是演示与真实
 * 复核两用的确定性近似，保证复核请求只携带局部区域。
 */
export async function cropImageBand(
  image: Blob,
  topRatio: number,
  bottomRatio: number,
): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(image);
    try {
      const top = Math.max(0, Math.min(0.95, topRatio));
      const bottom = Math.max(top + 0.05, Math.min(1, bottomRatio));
      const sourceHeight = Math.max(1, Math.round(bitmap.height * (bottom - top)));
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, sourceHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return image;
      context.drawImage(
        bitmap,
        0,
        bitmap.height * top,
        bitmap.width,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
      );
      return blob ?? image;
    } finally {
      bitmap.close();
    }
  } catch {
    return image;
  }
}
