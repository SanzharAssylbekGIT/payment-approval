import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getRequestForUser } from "@/lib/requests/queries";
import { prisma } from "@/lib/db";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// Скачивание вложения с проверкой доступа к заявке (тот же scope, что и карточка).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id, attachmentId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const req = await getRequestForUser(user, id);
  if (!req) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, requestId: id } });
  if (!attachment) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const data = await readFile(path.join(UPLOAD_DIR, attachment.filePath));
    // attachment (не inline) + nosniff: загруженный HTML/SVG со скриптом не
    // должен исполняться в origin приложения (stored XSS через вложение).
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "file missing" }, { status: 404 });
  }
}
