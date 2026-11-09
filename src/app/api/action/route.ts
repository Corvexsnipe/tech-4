import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { performAction } from "@/lib/actions";
import { assertSameOrigin } from "@/lib/security";
import { clientIp } from "@/lib/ip";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, deviceToken } from "@/lib/security/device";
import { randomBytes } from "node:crypto";
import { AppError } from "@/lib/db";
import { limitedBody } from "@/lib/validation";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("JSON is required.", 415);
    const input = z.object({ action: z.string().max(50), data: z.unknown() }).parse(JSON.parse((await limitedBody(request, 32 * 1024)).toString("utf8")));
    const device = deviceToken(request.headers);
    const response = NextResponse.json(await performAction(input.action, input.data, clientIp(request.headers), device), { headers: { "Cache-Control": "no-store" } });
    // Fallback for POST-first clients whose first contact is an action:
    // middleware normally issues the cookie on page load.
    if (!device) response.cookies.set(DEVICE_COOKIE, randomBytes(32).toString("hex"), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: DEVICE_COOKIE_MAX_AGE });
    return response;
  } catch (error) {
    let status = 500, message = "We couldn't complete that request. Please try again.";
    if (error instanceof AppError) { status = error.status; message = error.message; }
    else if (error instanceof z.ZodError) { status = 422; message = error.issues.map(i => `${i.path.join(".") || "Form"}: ${i.message}`).join(" "); }
    else if (error instanceof SyntaxError) { status = 400; message = "Invalid JSON request."; }
    else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") { status = 409; message = "This record already exists. You may already have an active review or claim."; }
      if (error.code === "P2025") { status = 404; message = "This record is no longer available."; }
      if (error.code === "P2034") { status = 409; message = "The record changed while saving. Refresh and try again."; }
    }
    // Never log request bodies, credentials, tokens, or raw database errors.
    if (status === 500) console.error("action_failed", { type: error instanceof Error ? error.name : "UnknownError", code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined });
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}
