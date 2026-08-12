import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/register-form";
import { getSessionUser } from "@/services/auth";

export default async function RegisterPage() {
  if (await getSessionUser()) redirect("/");
  return <RegisterForm />;
}
