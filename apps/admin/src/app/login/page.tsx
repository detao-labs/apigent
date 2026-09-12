import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin-login-form";
import { getAdminSessionUser } from "@/services/auth";

export default async function AdminLoginPage() {
  if (await getAdminSessionUser()) redirect("/");
  return <AdminLoginForm />;
}
