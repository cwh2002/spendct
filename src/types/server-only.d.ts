/**
 * server-only 标记包（Next.js 官方约束包）没有自带类型声明。
 * 本声明让 `import "server-only"` 通过 TS 检查；运行时行为由包的
 * react-server 导出条件决定：服务端为空模块，客户端打包直接抛错。
 */
declare module "server-only";
