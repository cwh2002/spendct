"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { CAPABILITIES, isCapabilityActive, type Capability } from "@/lib/capabilities";
import { ComingSoonModal } from "./coming-soon-modal";

const CARD_BASE =
  "relative flex flex-col rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4 text-left transition-all duration-200";

/**
 * 12 卡能力墙（08 §2.2 F01，A17 新增挑战/攒钱/海报三卡）：数据源只有 src/lib/capabilities 一份。
 * 已上线能力整卡可点跳转（hover 描边主色 + 阴影）；
 * 未上线能力灰显 + 右上「即将上线」角标，点击弹静态介绍层。
 */
export function CapabilityWall() {
  const [openCap, setOpenCap] = useState<Capability | null>(null);

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
        {CAPABILITIES.map((cap) => {
          const active = isCapabilityActive(cap);
          const Icon = cap.icon;

          const body = (
            <>
              <span
                aria-hidden
                className={`grid size-11 place-items-center rounded-(--radius-md) ${
                  active
                    ? "bg-(--color-primary-soft) text-(--color-primary)"
                    : "bg-(--color-surface-2) text-(--color-ink-muted)"
                }`}
              >
                <Icon className="size-5" />
              </span>
              <h3
                className={`mt-3 text-sm font-semibold ${
                  active ? "text-(--color-ink)" : "text-(--color-ink-muted)"
                }`}
              >
                {cap.title}
              </h3>
              <p
                className={`mt-1 min-h-10 text-xs leading-relaxed line-clamp-2 ${
                  active ? "text-(--color-ink-secondary)" : "text-(--color-ink-muted)"
                }`}
              >
                {cap.desc}
              </p>
            </>
          );

          const badge = !active ? (
            <span className="absolute top-2.5 right-2.5 rounded-full bg-(--color-warn) px-2 py-0.5 text-[10px] leading-4 font-bold text-(--color-warning-ink)">
              即将上线
            </span>
          ) : null;

          if (active && cap.href) {
            return (
              <li key={cap.id} className="h-full">
                <Link
                  href={cap.href}
                  className={`${CARD_BASE} h-full hover:border-(--color-primary) hover:shadow-(--shadow-md)`}
                >
                  {body}
                </Link>
              </li>
            );
          }

          return (
            <li key={cap.id} className="h-full">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setOpenCap(cap)}
                className={`${CARD_BASE} h-full cursor-pointer`}
              >
                {body}
                {badge}
              </button>
            </li>
          );
        })}
      </ul>

      <AnimatePresence>
        {openCap ? (
          <ComingSoonModal capability={openCap} onClose={() => setOpenCap(null)} />
        ) : null}
      </AnimatePresence>
    </>
  );
}
