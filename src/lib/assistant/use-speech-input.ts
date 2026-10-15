"use client";

/**
 * 语音输入（Web Speech API，08 修订案 A12 多模态落点之一）。
 *
 * 用浏览器自带的语音识别把说话转成文字，转写结果只写入聊天输入框；
 * 音频由浏览器厂商的语音服务处理，本项目服务器与大模型都不接收音频
 * （隐私口径见 02 §8 对照表「语音输入（可选）」行）。
 *
 * 识别能力与语言由浏览器决定（中文环境默认 zh-CN）；不支持 Web Speech
 * 的浏览器直接隐藏入口（supported = false），不降级到任何第三方服务。
 * 识别错误（无麦克风权限/没听清）以错误态回传，由调用方提示，不抛异常。
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** 语音输入状态：idle 未启动 / listening 收听中 / error 出错（message 为提示） */
export type SpeechState = "idle" | "listening" | "error";

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechResultEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

export interface SpeechInputHandle {
  /** 当前浏览器是否支持语音识别（不支持则入口隐藏） */
  supported: boolean;
  /** 识别状态（idle/listening/error） */
  state: SpeechState;
  /** 错误提示文案（state=error 时） */
  errorText: string;
  /** 开始/停止一轮收听 */
  toggle(): void;
}

/** 构造器兼容两种前缀（标准与 WebKit）；服务端渲染阶段无 window，恒返回 null */
function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * 语音输入 hook：轮询识别结果（最终句写入输入框，中间结果可选展示），
 * 一轮识别结束自动回到 idle；组件卸载时中止识别实例。
 */
export function useSpeechInput(onFinalText: (text: string) => void): SpeechInputHandle {
  // 支持能力在挂载后检测（SSR 阶段无 window，且服务端与客户端首帧必须一致，
  // 否则 hydration 不匹配）：麦克风入口在 mount 后出现，不参与首屏
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<SpeechState>("idle");
  const [errorText, setErrorText] = useState("");
  const instanceRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinalText);
  // 每次渲染后同步最新回调（识别轮询异步读 ref，避免闭包捕获旧函数）
  useEffect(() => {
    onFinalRef.current = onFinalText;
  });

  useEffect(() => {
    // 仅当浏览器提供识别构造器时置真；false 是初始值，不必再触发一次渲染。
    // 能力检测只能发生在挂载后（SSR 无 window），这是 setState-in-effect
    // 的合法场景：条件命中时恰好多渲染一次，无级联风险
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (recognitionCtor() !== null) setSupported(true);
  }, []);

  const stop = useCallback(() => {
    instanceRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    instanceRef.current = recognition;
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (!last) return;
      const text = last[0]?.transcript ?? "";
      if (text.trim()) onFinalRef.current(text.trim());
    };
    recognition.onerror = (event) => {
      const code = event.error ?? "unknown";
      setErrorText(
        code === "not-allowed"
          ? "麦克风权限被拒绝，请在浏览器设置里允许后重试"
          : code === "no-speech"
            ? "没有听清，请靠近麦克风再试一次"
            : "语音识别暂不可用，直接打字也可以",
      );
      setState("error");
    };
    recognition.onend = () => {
      setState((prev) => (prev === "error" ? "error" : "idle"));
      instanceRef.current = null;
    };
    setErrorText("");
    setState("listening");
    try {
      recognition.start();
    } catch {
      // 重复 start 等实现差异：按出错处理
      setErrorText("语音识别暂不可用，直接打字也可以");
      setState("error");
    }
  }, []);

  const toggle = useCallback(() => {
    if (state === "listening") stop();
    else start();
  }, [state, start, stop]);

  // 卸载时中止识别（识别实例是浏览器资源，不能随组件泄漏）
  useEffect(() => {
    return () => {
      instanceRef.current?.abort();
      instanceRef.current = null;
    };
  }, []);

  return { supported, state, errorText, toggle };
}
