import { redirect } from "next/navigation";

// Корень: аутентифицированных уводим на дашборд, остальных middleware уже
// отправил на /login.
export default function Home() {
  redirect("/dashboard");
}
