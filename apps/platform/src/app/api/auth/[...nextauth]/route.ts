// Auth.js 接管 /api/auth/*：signin / callback / session / csrf / signout 都由它提供。
// 注册（Auth.js 不涉及）在 /api/register。
//
// 注意必须解构出函数本身：`export { handlers as GET }` 导出的是那个对象，
// Next 会把它当请求处理器调用，运行时报
// "Function.prototype.apply was called on #<Object>"。
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
