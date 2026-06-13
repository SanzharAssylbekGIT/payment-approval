// Константы авторизации без серверных зависимостей — безопасно импортировать
// в edge-middleware (не тянет Prisma/crypto).
export const SESSION_COOKIE_NAME = "bt_session";
export const SESSION_TTL_DAYS = 7;
