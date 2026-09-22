import js from "@eslint/js";
import tseslint from "typescript-eslint";

// ── RAG 包的依赖方向与客户端边界（P2-8）────────────────────────────────
//
// 为什么用 lint 而不只靠测试：越界 import 应该在**写下的那一刻**就报错，
// 而不是等 CI 跑完测试才红。测试侧的同类守卫见 packages/rag/src/boundaries.test.ts
// （它额外覆盖「顶层 barrel 只以类型形式转发契约」这类 lint 表达不了的结构约束）。
const ragImportRestrictions = [
  {
    group: ["@apigent/server", "@apigent/server/*"],
    message:
      "依赖方向：@apigent/rag → @apigent/core，禁止 rag 反向依赖 server（docs/modules/rag-package.md §2.3）。DB 访问走注入的 SqlExecutor 端口。",
  },
  {
    group: ["**/testing/**", "../testing/*", "../../testing/*"],
    message:
      "生产代码不得 import 测试替身：阶段必须靠注册表注入（docs/modules/rag-package.md §2.2）。测试文件不受此限。",
  },
  {
    group: ["**/adapters/**", "../adapters/*", "../../adapters/*"],
    message: "生产代码不得直接 import 具体适配器：管线只认识端口与名字，实现由注册表注入（P2-6）。",
  },
];

/** 管线更严一层：连内置默认实现也不许直接 import。 */
const ragPipelineImportRestrictions = [
  ...ragImportRestrictions,
  {
    group: ["**/stages/**", "../stages", "../stages/*", "../../stages"],
    message:
      "管线只认识端口与名字：内置阶段实现由注册方注入（P2-6 / docs/modules/rag-package.md §3）。",
  },
];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/", "**/.turbo/", "**/node_modules/", "**/.next/", "**/coverage/"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["packages/rag/src/**/*.ts"],
    ignores: ["packages/rag/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ragImportRestrictions }],
    },
  },
  {
    files: ["packages/rag/src/pipeline/**/*.ts"],
    ignores: ["packages/rag/src/pipeline/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ragPipelineImportRestrictions }],
    },
  },
);
