// ═══════════════════════════════════════════════════════════════════
// RAG Pipeline — 阶段注册表
// ═══════════════════════════════════════════════════════════════════

import { RagConfigError } from "../contracts";
import type { RagStageFactoryMap, RagStageKind, RagStageRegistry } from "./types";

const KNOWN_STAGE_NAMES: RagStageKind[] = ["documentSource", "embedder", "denseIndex"];

export function createStageRegistry(): RagStageRegistry {
  const tables = new Map<RagStageKind, Map<string, unknown>>();
  for (const kind of KNOWN_STAGE_NAMES) tables.set(kind, new Map());

  function table(kind: RagStageKind): Map<string, unknown> {
    const existing = tables.get(kind);
    if (!existing) {
      // 类型上不可能发生；运行时兜住，是为了让「新增阶段忘了登记」变成明确错误，
      // 而不是静默创建一张没人读的表。
      throw new RagConfigError(`rag: 未知的阶段类型 "${kind}"`);
    }
    return existing;
  }

  return {
    register(kind, name, factory) {
      table(kind).set(name, factory);
    },

    resolve(kind, name) {
      const factory = table(kind).get(name);
      if (!factory) {
        const known = [...table(kind).keys()];
        throw new RagConfigError(
          `rag: 阶段 "${kind}" 的 provider "${name}" 未注册；` +
            (known.length > 0 ? `已注册：${known.join(", ")}` : "当前没有任何已注册实现"),
        );
      }
      return factory as RagStageFactoryMap[typeof kind];
    },

    has(kind, name) {
      return table(kind).has(name);
    },

    names(kind) {
      return [...table(kind).keys()];
    },
  };
}
