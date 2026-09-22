// ═══════════════════════════════════════════════════════════════════
// Stages — jiebaTokenizer（应用侧中文分词，P0-3 定案）
// ═══════════════════════════════════════════════════════════════════
//
// 为什么在应用侧而不是数据库里：目标镜像 `pgvector/pgvector:pg17` 没有
// pg_jieba / zhparser / pg_bigm，装 C 扩展要求用户在**数据库服务器**上编译，
// 还要跟着 PG 大版本重编译（spike §1）。`@node-rs/jieba` 是预编译二进制，
// 用户什么都不用装。代价是切分结果依赖库 / 词典版本 —— 用 `version` 兜住。
//
// ## 三条硬约束
//
// 1. **必须 `cutForSearch`，不得用 `cut`。** 实测默认模式把「发货单」切成单个
//    词元，用户查「发货」命中 0；`cutForSearch` 会同时输出 `发货` / `货单` /
//    发货单 这类重叠子词，命中恢复。这条有专门的测试，别改成 `cut`。
// 2. **进程级单例。** 词典常驻内存，`Jieba.withDict()` 只做一次；平台 / worker /
//    MCP 网关三个进程各加载一次（P0-3 已记录这个成本）。
// 3. **领域词典也是进程级的。** `loadDict` 是**增量合并**，同一进程里加载第二套
//    词典会污染第一套，切分结果从此不可复现 —— 所以遇到第二套直接抛错，而不是
//    默默合并。
// 4. **依赖版本精确固定，不用 caret。** `package.json` 里写的是 `"2.0.3"` 而不是
//    `"^2.0.3"`：切分口径被持久化进 `knowledge_chunks.tokenizer_version`（P3-1），
//    而 `dict.txt` 随包发布 —— 版本一动，存量索引的词元就与新查询对不上，必须全量
//    REINDEX。所以升级必须是一次**显式的、带 REINDEX 的**变更，而不是 `pnpm update`
//    顺带带进来的副作用。（锁文件本身已冻结解析结果，这条是让升级动作可见。）
//
// ## 为什么是惰性加载
//
// `@node-rs/jieba` 是原生模块，`@node-rs/jieba/dict` 一 import 就把词典文件读进
// 内存。静态 import 会让**任何** import 到本模块的进程（哪怕 `searchStore.provider:
// none`、哪怕只想用 `normalizeIdentifiers`）都付这个成本。所以这里用
// `createRequire` 惰性加载：工厂调用时才付首次加载开销（正好是启动期，fail-fast
// 的好位置），只想拿纯函数的人一分钱不花。
// ═══════════════════════════════════════════════════════════════════

import { createRequire } from "node:module";
import { RagConfigError, type Tokenizer } from "../contracts";
import { normalizeIdentifiers } from "./identifiers";

/**
 * 依赖版本的兜底值 —— 运行时优先读已安装包的 `package.json`，读不到才用它。
 * `jieba-tokenizer.test.ts` 会断言它与实际安装版本一致，所以它不会悄悄过期。
 */
export const JIEBA_LIB_VERSION_FALLBACK = "2.0.3";

/** 分词模式：见文件头的第 1 条硬约束。 */
const TOKENIZE_MODE = "cutForSearch";

/** 后处理（小写 / 丢纯标点）的实现版本：改了它就要 +1 并 REINDEX。 */
const NORMALIZATION_VERSION = "v1";

const BUILTIN_DICT_ID = "builtin";
const KEEP_TERM = /[a-z0-9\u3400-\u4dbf\u4e00-\u9fff]/u;

export interface JiebaDictionary {
  /** 词典标识（路径 / 版本号 / 内容哈希都行），会进 `version` 串 */
  id: string;
  /** jieba 词典格式：每行 `词 [词频] [词性]` */
  content: string;
}

export interface JiebaTokenizerOptions {
  /** 领域词典（退款 / 优惠券 / 库存 …），进程级生效 */
  dictionary?: JiebaDictionary;
  /** 是否启用 HMM 新词发现，默认与 jieba 一致（开） */
  hmm?: boolean;
}

interface JiebaModule {
  Jieba: {
    withDict(dict: Uint8Array): JiebaInstance;
  };
}

interface JiebaInstance {
  loadDict(dict: Uint8Array): void;
  cutForSearch(sentence: string, hmm?: boolean | null): string[];
}

/** 进程级单例（P0-3 约束 2）。 */
let shared: JiebaInstance | undefined;
/** 已加载的词典标识 —— 用来挡住「同一进程加载第二套词典」（约束 3）。 */
let loadedDictId: string | undefined;

export function jiebaTokenizer(options: JiebaTokenizerOptions = {}): Tokenizer {
  const hmm = options.hmm ?? true;
  const jieba = core(options.dictionary);
  const dictionaryId = loadedDictId ?? BUILTIN_DICT_ID;

  return {
    version: `${TOKENIZE_MODE}@jieba-${libVersion()}:dict=${dictionaryId}:hmm=${hmm ? 1 : 0}:norm=${NORMALIZATION_VERSION}`,
    tokenize: (text) => tokenize(jieba, text, hmm),
    normalizeIdentifiers,
  };
}

function tokenize(jieba: JiebaInstance, text: string, hmm: boolean): string[] {
  const terms: string[] = [];

  for (const raw of jieba.cutForSearch(text, hmm)) {
    const term = raw.normalize("NFC").toLowerCase().trim();
    // 丢掉纯标点 / 空白：它们对召回没有贡献，却会在查询侧拼 tsquery 时破坏语法
    // （P4-5 要在那里过滤一遍，这里先挡住更省事，也更不容易漏）。
    if (term === "" || !KEEP_TERM.test(term)) continue;
    terms.push(term);
  }

  return terms;
}

function core(dictionary?: JiebaDictionary): JiebaInstance {
  if (!shared) {
    const require = createRequire(import.meta.url);
    const { Jieba } = require("@node-rs/jieba") as JiebaModule;
    const { dict } = require("@node-rs/jieba/dict") as { dict: Uint8Array };
    shared = Jieba.withDict(dict);
    loadedDictId = BUILTIN_DICT_ID;
  }

  if (dictionary && loadedDictId !== dictionary.id) {
    if (loadedDictId !== BUILTIN_DICT_ID) {
      throw new RagConfigError(
        `jieba 词典是进程级配置：已加载 "${loadedDictId}"，不能再加载 "${dictionary.id}"。` +
          "同一进程出现两套词典会让切分结果不可复现（loadDict 是增量合并）。",
      );
    }
    shared.loadDict(Buffer.from(dictionary.content, "utf8"));
    loadedDictId = dictionary.id;
  }

  return shared;
}

function libVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@node-rs/jieba/package.json") as { version?: string };
    return pkg.version ?? JIEBA_LIB_VERSION_FALLBACK;
  } catch {
    // 打包器把 package.json 排除掉时走到这里：用兜底常量，并由测试保证它不漂。
    return JIEBA_LIB_VERSION_FALLBACK;
  }
}
