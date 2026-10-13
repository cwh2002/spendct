"use client";

import { create } from "zustand";
import {
  createSession,
  ensureDemoAccount,
  getSessionUser,
  loginAccount,
  logoutAccount,
  registerAccount,
} from "./auth";
import type { UserRecord } from "./types";

export interface RegisterInput {
  username: string;
  nickname: string;
  password: string;
}

export interface AuthState {
  user: UserRecord | null;
  status: "loading" | "guest" | "authed";
  hydrate(): Promise<void>;
  login(username: string, password: string, remember?: boolean): Promise<void>;
  register(input: RegisterInput, remember?: boolean): Promise<void>;
  logout(): Promise<void>;
}

/** hydrate 只执行一次的守卫：避免 StrictMode 双挂载或多个入口重复恢复会话 */
let hydratePromise: Promise<void> | null = null;

export const useAuth = create<AuthState>()((set) => ({
  user: null,
  status: "loading",

  async hydrate() {
    if (!hydratePromise) {
      hydratePromise = (async () => {
        try {
          const user = await getSessionUser();
          set({ user, status: user ? "authed" : "guest" });
        } catch {
          // IndexedDB 不可用（隐私模式）时降级为游客，不阻塞界面
          set({ user: null, status: "guest" });
        }
        // 种子账户放在会话恢复之后：demo 只补数据，绝不覆盖现有会话
        await ensureDemoAccount();
      })();
    }
    return hydratePromise;
  },

  async login(username, password, remember = true) {
    const user = await loginAccount(username, password, remember);
    set({ user, status: "authed" });
  },

  async register(input, remember = true) {
    const user = await registerAccount(input);
    // 注册即登录：注册本身不建会话（避免种子流程误建 demo 会话），这里补上
    await createSession(user.id, remember);
    set({ user, status: "authed" });
  },

  async logout() {
    await logoutAccount();
    set({ user: null, status: "guest" });
  },
}));
