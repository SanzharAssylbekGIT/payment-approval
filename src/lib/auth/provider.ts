import { credentialsProvider } from "./credentials";
import type { AuthProviderAdapter } from "./types";

// Выбор активного провайдера по env AUTH_PROVIDER. Точка расширения для SSO:
// добавить ssoProvider и ветку — вызывающий код (login action) не меняется.
export function getAuthProvider(): AuthProviderAdapter {
  const provider = process.env.AUTH_PROVIDER ?? "credentials";
  switch (provider) {
    case "credentials":
      return credentialsProvider;
    // case "sso": return ssoProvider; // на будущее
    default:
      return credentialsProvider;
  }
}
