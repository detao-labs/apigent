// Auth.js 接管 /api/auth/*：signin / callback / session / csrf / signout。
// 必须解构出函数本身（见 platform 同名文件的说明）。
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
