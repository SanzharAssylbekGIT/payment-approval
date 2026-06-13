import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { AuthProviderAdapter } from "./types";

// Credentials-провайдер (MVP): e-mail + пароль, хэш bcrypt.
export const credentialsProvider: AuthProviderAdapter = {
  id: "credentials",

  async verifyCredentials(email, password) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || !user.isActive || !user.passwordHash) return null;

    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user.id : null;
  },
};
