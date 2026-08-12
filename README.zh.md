# apigent

> 🌐 Language: [English](./README.md) | [中文](./README.zh.md)

面向 AI Agent 原生支持的下一代 API 协作平台

## 开发

数据库（Drizzle，需在 `.env` 中配置 `APIGENT_DATABASE_URL`）：

```bash
pnpm db:migrate                             # 应用待执行迁移
pnpm db:generate -- --name=add_users        # 生成迁移并指定有意义的名称
pnpm db:push                                # 直接同步 schema（仅开发环境）
pnpm db:seed                                # 写入开发数据
pnpm db:studio                              # 用 Drizzle Studio 浏览表
```

启动应用：`pnpm dev`（platform :3000、admin :3001、open 网关 :3002）。
