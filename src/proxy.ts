import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, DEVICE_TOKEN_RE } from "@/lib/security/device-cookie";

// Issues the first-party device identifier to every visitor on their first
// page view, before they ever reach a form. An existing well-formed token is
// kept; a missing or malformed one is rotated. The token is random — it
// carries no device, browser, or personal data.
export default function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const existing = request.cookies.get(DEVICE_COOKIE)?.value;
  if (!DEVICE_TOKEN_RE.test(existing || "")) {
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
    response.cookies.set(DEVICE_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE,
    });
  }
  return response;
}

// Pages only: static assets, the API, and metadata routes do not need the
// cookie (the action route also issues it as a fallback for POST-first flows).
export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
