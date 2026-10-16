"use client";

/**
 * 管线会话恢复挂载点（08 修订案 A18）：全站布局常驻，无可见 UI。
 *
 * 页面加载时做两件事：
 * 1. 订阅管线内存态变化，把体检结果增量同步进 IndexedDB
 *    （startPipelineSnapshotSync，卸载时退订）；
 * 2. 恢复上次导入的数据集与体检结果（restorePipelineSnapshot，
 *    IndexedDB 无记录时是零成本 no-op，不启动 DuckDB）。
 */
import { useEffect } from "react";

import {
  restorePipelineSnapshot,
  startPipelineSnapshotSync,
} from "@/lib/persistence/pipeline-persistence";

export function PipelineRestore() {
  useEffect(() => {
    const stopSync = startPipelineSnapshotSync();
    void restorePipelineSnapshot();
    return stopSync;
  }, []);

  return null;
}
