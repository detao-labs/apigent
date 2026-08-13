---
name: ux-design
description: >-
  Design and iterate on product/platform UX mockups as standalone, interactive
  HTML wireframes (UX 稿). Use when the user asks to plan or design page layouts,
  页面设计, UX 稿, wireframes, or mockups for a web app / platform / console —
  including information architecture, global navigation (top bar, grouped sidebar,
  detail-page rails), settings pages, and clickable interaction prototypes — across
  any project, plus a single-language design doc (UX MD, Chinese by default) kept
  in sync with the mockups. Also use when the user iterates with feedback about menu
  grouping, independent layouts, settings page vs modal, back buttons, or rail/sidebar structure.
---

# UX Mockup Design（UX 稿设计）

产出独立、可交互的静态 HTML UX 稿，与源代码分离、可双击预览；同时维护一份中文设计文档。适用于任意项目。

## 1. 交付约定

- 目录：仓库根目录 `design/<product>/`，不与源代码混合；每页一个 `.html`，共享 `assets/mockup.css` + `assets/mockup.js`；不用构建工具、框架、CDN。
- 页面较多时提供 `index.html` 目录页；文案跟随用户语言（中文为主）。
- 设计文档：`docs/design/<product>-ux.md`，单语言中文，与 HTML 稿同步维护（见 §3）。

## 2. 页面设计规范

布局模式与交互要求见独立文档 `references/design-spec.md`：全局顶栏、主侧栏分组、详情页独立 rail、设置页 vs 弹窗、品牌定位、交互要求。做页面或收到布局反馈时先读该文档，再动手。

## 3. 设计文档（UX MD）

- 与 HTML 稿互补：文档记录「做成什么样、为什么」，HTML 稿展示交互。
- 结构：标题与一句话定位 → 设计目标与原则 → 用户与核心任务 → 信息架构 → 页面清单（表格含 HTML 文件列，与实际文件一致）→ 关键决策（决策/理由/状态）→ 交互与状态约定 → 资源位置。
- 每次改动同步更新：页面增删/改名、菜单分组、弹窗 vs 页面、品牌文案。

## 4. 工作流

1. 先列页面清单与导航归属，关键决策（分组、独立布局、弹窗 vs 页面）先与用户确认。
2. 先做全局壳（顶栏+侧栏）与 2-3 个代表页，确认后再铺开。
3. 每次反馈应用到所有相关页面，并同步更新设计文档。
4. 交付前自查：抽查 HTML div 配对与内部链接、用 `node --check` 校验 JS、核对设计文档页面清单与实际文件一致；再浏览器抽查关键页面。
5. 汇总时说明文件位置、页面清单、交互覆盖与文档同步情况。
