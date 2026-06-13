import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

// Лёгкая проверка на edge: только наличие cookie сессии. Полная валидация
// (сессия жива, юзер активен) — в getCurrentUser() на уровне страниц/действий,
// т.к. middleware не ходит в БД.
//
// ВАЖНО: middleware НЕ редиректит /login → /dashboard по факту наличия cookie.
// Иначе при невалидной (удалённой/истёкшей) сессии возникает петля: защищённая
// страница уводит на /login (юзер null), а middleware гонит обратно на /dashboard.
// Решение «залогинен → пропустить /login» принимает сама страница /login,
// проверяя сессию по БД (там есть доступ к Prisma).
const PUBLIC_PATHS = ["/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSession && !PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Исключаем статику и файлы с расширением.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
