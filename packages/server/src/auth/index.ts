// ═══════════════════════════════════════════════════════════════════
// Apigent Auth — shared auth primitives
// ═══════════════════════════════════════════════════════════════════
//
// 只保留与框架无关的凭据原语。**会话本身已经交给 Auth.js**（Platform 与 Admin
// 各自一个实例，见 @apigent/auth）；自研的 HMAC 会话在迁移完成后已删除——它当时
// 已无任何调用方，留着只会让人误以为它还在生效路径上。

export { hashPassword, verifyPassword } from "./password";
