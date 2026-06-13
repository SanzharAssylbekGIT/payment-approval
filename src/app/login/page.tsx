import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

// Серверная проверка: если сессия валидна (по БД) — на дашборд. Иначе показываем
// форму. Это валидирует сессию по-настоящему и не создаёт петлю при stale-cookie.
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  return <LoginForm />;
}
