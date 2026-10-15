import type { NextConfig } from "next";

/**
 * serverExternalPackages：RAG 检索用到的原生模块不参与打包——
 * @huggingface/transformers（onnxruntime-node 后端）与 sharp 保持外部引用，
 * 避免 Turbopack 打包原生二进制失败或内存暴涨（04 §3.5）；
 * 安全响应头与运行时锁定见 vercel.json（部署配置的唯一维护点）。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
};

export default nextConfig;
