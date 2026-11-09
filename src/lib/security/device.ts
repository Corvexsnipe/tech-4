import { createHmac } from "node:crypto";
import { securityConfig } from "./config";

// First-party device recognition, privacy-conscious by design:
//  - The identifier is a cryptographically random token set by the server in a
//    Secure, HttpOnly, SameSite=Lax first-party cookie (`rm_device`; `__Host-`
//    prefixed in production). It carries no browser or hardware data — no
//    IMEI, MAC, serial numbers, and no fingerprinting of browser traits.
//  - Only a keyed HMAC of the token is ever stored or used for matching, so a
//    database copy cannot be reversed into a usable identifier. Clearing
//    cookies, using private browsing, or switching devices/browsers yields a
//    new identifier: the value is a risk signal, never proof of identity.
// The cookie is essential for review-integrity and abuse prevention, so it
// falls under strictly-necessary cookie exemptions; the privacy policy
// discloses it.
export { DEVICE_COOKIE, DEVICE_TOKEN_RE, DEVICE_COOKIE_MAX_AGE } from "./device-cookie";
import { DEVICE_COOKIE, DEVICE_TOKEN_RE } from "./device-cookie";

// Reads the device token from a request's raw Cookie header. Route handlers
// see the request before any newly issued cookie, so a malformed or absent
// token simply yields no device signal rather than an error.
export function deviceToken(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DEVICE_COOKIE) {
      const value = rest.join("=").trim();
      return DEVICE_TOKEN_RE.test(value) ? value : null;
    }
  }
  return null;
}

// Keyed hashes — same rotation model as ipHashCurrent/ipHashes: version 1 is
// the legacy APP_SECRET key, version 2 the dedicated ANTI_VPN_HMAC_SECRET.
// deviceHashes() returns every key's hash so rotation cannot reopen a slot.
function hmac(tokenValue: string, key: string) {
  return createHmac("sha256", key).update(`review-device:${tokenValue}`).digest("hex");
}
export function deviceHashCurrent(tokenValue: string): { hash: string; version: 1 | 2 } {
  const config = securityConfig();
  const key = config.hmacSecret || "dev-only-secret";
  return { hash: hmac(tokenValue, key), version: config.hmacVersion };
}
export function deviceHashes(tokenValue: string): string[] {
  const current = deviceHashCurrent(tokenValue);
  const legacy = process.env.APP_SECRET ? hmac(tokenValue, process.env.APP_SECRET) : null;
  return legacy && legacy !== current.hash ? [current.hash, legacy] : [current.hash];
}
