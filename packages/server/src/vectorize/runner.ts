// ═══════════════════════════════════════════════════════════════════
// Vectorize Runner — 摄取执行能力（由宿主的 RAG 装配注入）
// ═══════════════════════════════════════════════════════════════════
//
// 任务层（本模块所在的 `vectorize/`）负责「什么时候索引、索引哪个 commit、失败了
// 怎么重试」；**怎么索引**（文档源 / 分词 / embedding / 向量库 / provider 选择）
// 属于 `@apigent/rag`，由 P6-1 在启动期用配置装配好之后注册进来。
//
// 为什么不在这里直接 `createRagService(...)`：
//   1. 那会把「provider 装配 + 配置解析 + 连接池」塞进任务模块，P6-1 的 API route
//      还得再装配一遍 —— 同一套 provider 选择出现两处，迟早不一致；
//   2. 注册点在启动期只调一次，装配错误应在**进程启动时**暴露，而不是等第一个
//      摄取任务跑起来才炸（P0-6 的 fail-fast）；
//   3. 测试可以注册替身，不必为「测任务重试」准备真实 embedding 与向量库。
//
// 未注册时 `getVectorizeRunner()` 抛 `disabled`（fail-fast），**自动触发**走
// `triggerVectorize()` 只记日志 —— 两者语义不同，见 service.ts。
// ═══════════════════════════════════════════════════════════════════

import type { IndexReport, IndexRequest } from "@apigent/rag/contracts";
import { VectorizeTaskError } from "./common";

/**
 * 执行一次摄取的函数形态 —— 与 `RagService.index` 同签名。
 *
 * 直接复用 RAG 的契约类型而不是自定义一套：摄取请求/报告的字段（commitId、
 * endpoints、force、chunksSkipped…）在两边必须逐字一致，各写一份就等着漂移。
 */
export type VectorizeRunner = (request: IndexRequest) => Promise<IndexReport>;

let runner: VectorizeRunner | undefined;

/** 启动期注册（P6-1）。重复注册以后注册者为准 —— 与容器 provider 的约定一致。 */
export function setVectorizeRunner(next: VectorizeRunner): void {
  runner = next;
}

/** 进程退出或测试清理时用。 */
export function clearVectorizeRunner(): void {
  runner = undefined;
}

export function hasVectorizeRunner(): boolean {
  return runner !== undefined;
}

export function getVectorizeRunner(): VectorizeRunner {
  if (!runner) {
    throw new VectorizeTaskError(
      "disabled",
      "RAG ingestion is not enabled in this deployment: no vectorize runner is registered. " +
        "Register one at startup with setVectorizeRunner() (see docs/modules/rag-package-tasks.md P6-1).",
    );
  }
  return runner;
}
