"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getAuthProvider } from "@/lib/auth/provider";
import { createSession } from "@/lib/auth/session";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Введите корректный e-mail и пароль" };
  }

  const provider = getAuthProvider();
  const userId = await provider.verifyCredentials?.(
    parsed.data.email,
    parsed.data.password,
  );
  if (!userId) {
    return { error: "Неверный e-mail или пароль" };
  }

  await createSession(userId);
  redirect("/dashboard");
}
