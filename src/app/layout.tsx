import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brave Talents — Платежи и учёт",
  description:
    "Внутренняя система согласования платежей и управленческого учёта Brave Talents",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
