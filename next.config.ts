import type { NextConfig } from "next";

/**
 * 服务端不引用 wasm，无需 serverExternalPackages；
 * 安全响应头与运行时锁定见 vercel.json（部署配置的唯一维护点）。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
