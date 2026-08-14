// ═══════════════════════════════════════════════════════════════════
// Context Executor — 业务上下文生成任务执行器（Worker 调用）
// ═══════════════════════════════════════════════════════════════════
//
// 流程：指纹复用分析 → 对未复用接口分批调 LLM（结构化输出）→ upsert
// business_contexts → 规则聚合 capability_context → 通知。
// 部分失败语义：接口级失败记入 result.failed，任务仍 succeeded。
// ═══════════════════════════════════════════════════════════════════

import { and, desc, eq, ne } from "drizzle-orm";
import { generateText } from "ai";
import { z } from "zod";
import { loadConfig } from "@apigent/core/config";
import {
  BusinessContextSchema,
  CONSTRAINT_TYPES,
} from "@apigent/core/agent";
import { generateId } from "../id";
import {
  businessContexts,
  endpoints,
  endpointResponses,
  getDB,
  repositories,
  repoVersions,
  repoTasks,
} from "../db";
import { createAIModel } from "../ai/model";
import { notifySafely } from "../notifications";
import { logError, logInfo } from "../logger";
import { buildCapabilitySnapshot } from "./aggregate";
import type { RepoProfileSummary } from "./aggregate";
import { computeEndpointFingerprint, endpointKey } from "./fingerprint";
import type { ContextTaskResult } from "./service";

type TaskStatus = "queued" | "running" | "succeeded" | "failed";

async function updateTask(
  taskId: string,
  patch: {
    status?: TaskStatus;
    progress?: number;
    result?: unknown;
    error?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
  },
): Promise<void> {
  await getDB()
    .update(repoTasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(repoTasks.id, taskId));
}

interface EndpointInput {
  id: string;
  operationId: string | null;
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  parameters: unknown;
  requestSchema: unknown;
  responses: Array<{
    statusCode: string;
    contentType: string | null;
    schema: unknown;
  }>;
}

async function loadEndpoints(versionId: string): Promise<EndpointInput[]> {
  const db = getDB();
  const rows = await db
    .select({
      id: endpoints.id,
      operationId: endpoints.operationId,
      method: endpoints.method,
      path: endpoints.path,
      summary: endpoints.summary,
      description: endpoints.description,
      parameters: endpoints.parameters,
      requestSchema: endpoints.requestSchema,
    })
    .from(endpoints)
    .where(eq(endpoints.versionId, versionId))
    .orderBy(endpoints.path, endpoints.method);

  const responseRows = await db
    .select({
      endpointId: endpointResponses.endpointId,
      statusCode: endpointResponses.statusCode,
      contentType: endpointResponses.contentType,
      schema: endpointResponses.schema,
    })
    .from(endpointResponses)
    .innerJoin(endpoints, eq(endpoints.id, endpointResponses.endpointId))
    .where(eq(endpoints.versionId, versionId))
    .orderBy(endpointResponses.statusCode);

  const responsesByEndpoint = new Map<string, EndpointInput["responses"]>();
  for (const row of responseRows) {
    const list = responsesByEndpoint.get(row.endpointId) ?? [];
    list.push({
      statusCode: row.statusCode,
      contentType: row.contentType,
      schema: row.schema,
    });
    responsesByEndpoint.set(row.endpointId, list);
  }

  return rows.map((row) => ({
    ...row,
    parameters: row.parameters ?? [],
    requestSchema: row.requestSchema ?? null,
    responses: responsesByEndpoint.get(row.id) ?? [],
  }));
}

/** 每批 LLM 的输入摘要（技术模型转文本，供 prompt 使用） */
function endpointToText(ep: EndpointInput): string {
  return JSON.stringify({
    method: ep.method,
    path: ep.path,
    summary: ep.summary,
    description: ep.description,
    parameters: ep.parameters,
    requestBody: ep.requestSchema,
    responses: ep.responses,
  });
}

function buildSystemPrompt(language: "auto" | "zh" | "en"): string {
  const langRule =
    language === "zh"
      ? "全部用中文输出。"
      : language === "en"
        ? "Output everything in English."
        : "输出语言跟随接口描述语言，未指定时默认中文。";
  return `你是 Apigent 平台的 API 业务上下文分析师。${langRule}
为每个接口生成结构化业务上下文：
- capability_name：简洁的业务名词（如"订单退款"）；
- intent：一句话说明接口做什么；
- constraints：只列后端强制的规则，数组每一项必须是 {"type": "precondition|time_limit|permission|format|business_rule|other", "rule": "规则描述"}，不要使用 description 字段；
- side_effects：接口调用后产生的业务副作用；
- usage_scenarios：典型使用场景；
- confidence：0-1 置信度，信息不足时降低并置 needs_review=true；
- 不得编造接口不存在的语义；无法判断时降低置信度并标记 needs_review。`;
}

/** 兼容模型输出 constraints 使用 description 字段的情况（rule 优先）。 */
const ConstraintInputSchema = z
  .object({
    type: z.enum(CONSTRAINT_TYPES).catch("other"),
    rule: z.string().optional(),
    description: z.string().optional(),
  })
  .transform((item) => ({
    type: item.type,
    rule: item.rule ?? item.description ?? "",
  }));

const BatchResultSchema = z.object({
  endpoints: z.array(
    z.object({
      endpointKey: z.string(),
      context: BusinessContextSchema.extend({
        constraints: z.array(ConstraintInputSchema),
      }),
    }),
  ),
});

/** 从模型输出中提取 JSON 对象（容忍代码块围栏与前后噪声）。 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

async function generateBatch(
  batch: EndpointInput[],
  language: "auto" | "zh" | "en",
): Promise<Array<{ endpointKey: string; context: z.infer<typeof BusinessContextSchema> }>> {
  const prompt =
    batch.map((ep) => endpointToText(ep)).join("\n---\n") +
    `\n\n只输出一个 JSON 对象，不要输出任何其他文字、解释或代码块标记。` +
    `格式：{"endpoints":[{"endpointKey":"<method path>","context":{capabilityName,intent,constraints,sideEffects,usageScenarios,confidence,needsReview}}]}`;

  // 部分 provider（如 qwen 兼容端点）不支持 structured output（response_format
  // json_schema），用 generateText + 自解析 JSON，失败重试一次。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { text } = await generateText({
        model: createAIModel("business_context"),
        system: buildSystemPrompt(language),
        prompt,
      });
      const parsed = BatchResultSchema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data.endpoints;
      throw new Error(
        `Model output did not match schema: ${text.slice(0, 800)}`,
      );
    } catch (err) {
      if (attempt === 1) throw err;
    }
  }
  throw new Error("generateBatch: unreachable");
}

function buildRepoProfilePrompt(language: "auto" | "zh" | "en"): string {
  const langRule =
    language === "zh"
      ? "全部用中文输出。"
      : language === "en"
        ? "Output everything in English."
        : "输出语言跟随接口描述语言，未指定时默认中文。";
  return `你是 Apigent 平台的仓库级业务分析师。${langRule}
根据下列接口级业务上下文，总结整个仓库的业务画像：
- capability_name：仓库业务领域名（如"订单与支付"）；
- intent：一句话说明这个仓库整体提供什么能力（仓库定位）；
- constraints：领域级通用约束（跨接口成立的规则，如"退款仅限支付后 7 天内"）；
- side_effects：仓库级副作用（如"操作会写入审计日志"）；
- usage_scenarios：典型业务流程（如"创建订单 → 支付 → 退款"）；
- confidence：0-1 置信度，信息不足时降低并置 needs_review=true；
- 只输出一个 JSON 对象，不要输出其他文字或代码块标记；
- 格式：{"capabilityName":"...","intent":"...","constraints":[{"type":"...","rule":"..."}],"sideEffects":["..."],"usageScenarios":["..."],"confidence":0.8,"needsReview":false}`;
}

/**
 * 生成仓库级业务画像（LLM 一次总结）。
 * 无接口上下文时返回 null（跳过画像生成）。
 */
async function generateRepoProfile(
  versionId: string,
  language: "auto" | "zh" | "en",
): Promise<z.infer<typeof BusinessContextSchema> | null> {
  const db = getDB();
  const rows = await db
    .select({
      capabilityName: businessContexts.capabilityName,
      intent: businessContexts.intent,
      constraints: businessContexts.constraints,
      usageScenarios: businessContexts.usageScenarios,
    })
    .from(businessContexts)
    .innerJoin(endpoints, eq(endpoints.id, businessContexts.endpointId))
    .where(
      and(
        eq(businessContexts.entityType, "endpoint"),
        eq(businessContexts.versionId, versionId),
      ),
    );
  const usable = rows.filter(
    (row) => row.capabilityName || row.intent,
  );
  if (usable.length === 0) return null;

  const prompt = usable
    .map((row) =>
      JSON.stringify({
        capabilityName: row.capabilityName,
        intent: row.intent,
        constraints: row.constraints,
        usageScenarios: row.usageScenarios,
      }),
    )
    .join("\n---\n");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { text } = await generateText({
        model: createAIModel("business_context"),
        system: buildRepoProfilePrompt(language),
        prompt,
      });
      const parsed = BusinessContextSchema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
      throw new Error(`Repo profile output did not match schema: ${text.slice(0, 400)}`);
    } catch (err) {
      if (attempt === 1) {
        logError("business.context.repo_profile_failed", err, { versionId });
      }
    }
  }
  return null;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** 固定并发数消费批次（实现 businessContext.concurrency）。 */
async function runChunks<T>(
  chunks: T[][],
  concurrency: number,
  fn: (chunk: T[]) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, chunks.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < chunks.length) {
      const chunk = chunks[index++];
      await fn(chunk);
    }
  });
  await Promise.all(workers);
}

/**
 * 执行上下文生成任务。任务已非 queued 时直接返回（幂等）。
 * 接口级失败不中断任务（计入 result.failed）；不可恢复错误置 failed 并重抛。
 */
export async function executeContextTask(taskId: string): Promise<void> {
  const db = getDB();
  const [task] = await db
    .select()
    .from(repoTasks)
    .where(eq(repoTasks.id, taskId))
    .limit(1);
  if (!task) throw new Error(`Context task not found: ${taskId}`);
  if (task.status !== "queued") {
    logInfo("business.context.skipped", {
      taskId,
      repoId: task.repoId,
      status: task.status,
    });
    return;
  }

  await updateTask(taskId, { status: "running", progress: 1, startedAt: new Date() });

  try {
    const payload = task.payload as {
      trigger?: "auto" | "manual";
      endpointIds?: string[];
      force?: boolean;
    };
    const force = payload.force ?? false;

    const [repoRow] = await db
      .select({ currentVersionId: repositories.currentVersionId })
      .from(repositories)
      .where(eq(repositories.id, task.repoId))
      .limit(1);
    const versionId = task.versionId ?? repoRow?.currentVersionId ?? null;
    if (!versionId) {
      throw new Error(`Repository ${task.repoId} has no version to generate context for.`);
    }

    // 上一版（指纹复用来源）
    const [prevVersion] = await db
      .select({ id: repoVersions.id })
      .from(repoVersions)
      .where(and(eq(repoVersions.repoId, task.repoId), ne(repoVersions.id, versionId)))
      .orderBy(desc(repoVersions.importedAt))
      .limit(1);

    const currentEndpoints = await loadEndpoints(versionId);
    const scopeSet = payload.endpointIds?.length
      ? new Set(payload.endpointIds)
      : null;
    const targets = scopeSet
      ? currentEndpoints.filter((ep) => scopeSet.has(ep.id))
      : currentEndpoints;

    // 上一版 context 映射（按 endpointKey）
    const prevContexts = new Map<
      string,
      { endpoint: EndpointInput; context: typeof businessContexts.$inferSelect }
    >();
    if (prevVersion) {
      const prevEndpoints = await loadEndpoints(prevVersion.id);
      const prevRows = await db
        .select()
        .from(businessContexts)
        .where(
          and(
            eq(businessContexts.entityType, "endpoint"),
            eq(businessContexts.versionId, prevVersion.id),
          ),
        );
      const byEndpointId = new Map(prevRows.map((row) => [row.endpointId, row]));
      for (const ep of prevEndpoints) {
        const context = byEndpointId.get(ep.id);
        if (context) prevContexts.set(endpointKey(ep), { endpoint: ep, context });
      }
    }

    // 当前版本已有 context（重跑/人工编辑保护）
    const currentRows = await db
      .select()
      .from(businessContexts)
      .where(
        and(
          eq(businessContexts.entityType, "endpoint"),
          eq(businessContexts.versionId, versionId),
        ),
      );
    const existingByEndpoint = new Map(currentRows.map((row) => [row.endpointId, row]));

    const config = loadConfig().businessContext;
    const minConfidence = config.minConfidence;
    const language = config.language;

    let reused = 0;
    let generated = 0;
    let failed = 0;
    let skipped = 0;
    let processed = 0;
    const pending: EndpointInput[] = [];

    for (const ep of targets) {
      const fp = computeEndpointFingerprint(ep);
      const existing = existingByEndpoint.get(ep.id);

      if (existing?.editedByHuman && !force) {
        // 人工编辑保护：跳过，视为已处理
        skipped += 1;
        processed += 1;
        continue;
      }

      const prev = prevContexts.get(endpointKey(ep));
      if (
        prev &&
        prev.context &&
        computeEndpointFingerprint(prev.endpoint) === fp
      ) {
        await db.insert(businessContexts).values({
          id: generateId("context"),
          entityType: "endpoint",
          entityId: ep.id,
          endpointId: ep.id,
          versionId,
          capabilityName: prev.context.capabilityName,
          intent: prev.context.intent,
          constraints: prev.context.constraints ?? [],
          sideEffects: prev.context.sideEffects ?? [],
          usageScenarios: prev.context.usageScenarios ?? [],
          confidence: prev.context.confidence,
          needsReview: prev.context.needsReview ?? false,
          sourceContextId: prev.context.id,
          fingerprint: fp,
          generatedBy: "reused",
        });
        reused += 1;
        processed += 1;
      } else {
        pending.push(ep);
      }
    }

    const totalCount = processed + pending.length;
    const reportProgress = () => {
      void updateTask(taskId, {
        progress:
          totalCount === 0 ? 100 : Math.round((processed / totalCount) * 100),
        result: {
          totalCount,
          processedCount: processed,
          reusedCount: reused,
          generatedCount: generated,
          failedCount: failed,
          skippedCount: skipped,
        } satisfies ContextTaskResult,
      });
    };
    reportProgress();

    const chunks = chunkArray(pending, config.batchSize);
    await runChunks(chunks, config.concurrency, async (chunk) => {
      const byKey = new Map(chunk.map((ep) => [endpointKey(ep), ep]));
      try {
        const items = await generateBatch(chunk, language);
        const returnedKeys = new Set(items.map((item) => item.endpointKey));
        for (const item of items) {
          const ep = byKey.get(item.endpointKey);
          if (!ep) continue;
          const fp = computeEndpointFingerprint(ep);
          const confidence = item.context.confidence;
          await db
            .insert(businessContexts)
            .values({
              id: generateId("context"),
              entityType: "endpoint",
              entityId: ep.id,
              endpointId: ep.id,
              versionId,
              capabilityName: item.context.capabilityName,
              intent: item.context.intent,
              constraints: item.context.constraints,
              sideEffects: item.context.sideEffects,
              usageScenarios: item.context.usageScenarios,
              confidence,
              needsReview:
                item.context.needsReview || confidence < minConfidence,
              fingerprint: fp,
              generatedBy: "ai",
            })
            .onConflictDoNothing();
          generated += 1;
        }
        for (const ep of chunk) {
          if (!returnedKeys.has(endpointKey(ep))) {
            failed += 1;
            processed += 1;
          }
        }
      } catch (err) {
        logError("business.context.batch_failed", err, {
          taskId,
          repoId: task.repoId,
          batchSize: chunk.length,
        });
        for (const _ep of chunk) {
          failed += 1;
          processed += 1;
        }
      }
      reportProgress();
    });

    // 全部失败（0 成功且无跳过）视为任务失败，允许重试；
    // 全部为人工编辑跳过时任务成功（无失败发生）；部分失败仍算主体完成
    if (totalCount > 0 && reused + generated === 0 && skipped === 0) {
      throw new Error("All endpoints failed to generate context");
    }

    // 仓库级业务画像：LLM 汇总接口级上下文，写入 entity_type='repo'
    const repoProfile = await generateRepoProfile(versionId, language);
    if (repoProfile) {
      await db
        .insert(businessContexts)
        .values({
          id: generateId("context"),
          entityType: "repo",
          entityId: task.repoId,
          versionId,
          capabilityName: repoProfile.capabilityName,
          intent: repoProfile.intent,
          constraints: repoProfile.constraints,
          sideEffects: repoProfile.sideEffects,
          usageScenarios: repoProfile.usageScenarios,
          confidence: repoProfile.confidence,
          needsReview:
            repoProfile.needsReview || repoProfile.confidence < minConfidence,
          generatedBy: "ai",
        })
        .onConflictDoUpdate({
          target: [
            businessContexts.entityType,
            businessContexts.entityId,
            businessContexts.versionId,
          ],
          set: {
            capabilityName: repoProfile.capabilityName,
            intent: repoProfile.intent,
            constraints: repoProfile.constraints,
            sideEffects: repoProfile.sideEffects,
            usageScenarios: repoProfile.usageScenarios,
            confidence: repoProfile.confidence,
            needsReview:
              repoProfile.needsReview ||
              repoProfile.confidence < minConfidence,
            updatedAt: new Date(),
          },
        });
    }

    const profileSummary: RepoProfileSummary | null = repoProfile
      ? {
          intent: repoProfile.intent,
          constraints: repoProfile.constraints,
          sideEffects: repoProfile.sideEffects,
          usageScenarios: repoProfile.usageScenarios,
        }
      : null;

    await buildCapabilitySnapshot(task.repoId, versionId, {
      endpointCount: totalCount,
      generatedCount: generated,
      reusedCount: reused,
      failedCount: failed,
    }, profileSummary);

    await updateTask(taskId, {
      status: "succeeded",
      progress: 100,
      result: {
        totalCount,
        processedCount: processed,
        reusedCount: reused,
        generatedCount: generated,
        failedCount: failed,
        skippedCount: skipped,
      },
      finishedAt: new Date(),
    });

    await notifySafely({
      userId: task.userId,
      category: "context",
      type: "context.ready",
      priority: failed > 0 ? "medium" : "medium",
      titleKey:
        failed > 0
          ? "notifications.context.readyWithFailures"
          : skipped > 0 && reused + generated === 0
            ? "notifications.context.readySkipped"
            : "notifications.context.ready",
      titleParams: {
        repoName: task.repoId,
        generatedCount: generated,
        reusedCount: reused,
        failedCount: failed,
        skippedCount: skipped,
      },
      payload: {
        href: `/repos/${task.repoId}/context`,
        repoId: task.repoId,
        versionId,
        taskId,
      },
      metadata: { orgId: null },
    });

    logInfo("business.context.completed", {
      taskId,
      repoId: task.repoId,
      userId: task.userId,
      versionId,
      trigger: payload.trigger,
      stats: { totalCount, processedCount: processed, reusedCount: reused, generatedCount: generated, failedCount: failed, skippedCount: skipped },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateTask(taskId, {
      status: "failed",
      error: message,
      finishedAt: new Date(),
    });
    await notifySafely({
      userId: task.userId,
      category: "context",
      type: "context.failed",
      priority: "high",
      titleKey: "notifications.context.failed",
      titleParams: { repoName: task.repoId, error: message },
      payload: {
        href: `/repos/${task.repoId}/context`,
        repoId: task.repoId,
        taskId,
      },
      metadata: { orgId: null },
    });
    logError("business.context.failed", err, {
      taskId,
      repoId: task.repoId,
      userId: task.userId,
    });
    throw err;
  }
}
