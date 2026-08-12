# apigent

> 🌐 Language: [English](./README.md) | [中文](./README.zh.md)

Next-generation API collaboration platform with native support for AI Agents

## Development

Database (Drizzle, requires `APIGENT_DATABASE_URL` in `.env`):

```bash
pnpm db:migrate                             # apply pending migrations
pnpm db:generate -- --name=add_users        # new migration with a meaningful name
pnpm db:push                                # sync schema directly (dev only)
pnpm db:seed                                # seed development data
pnpm db:studio                              # browse tables in Drizzle Studio
```

Run the web apps with `pnpm dev` (platform on :3000, admin on :3001, open gateway on :3002).
