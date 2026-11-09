// Cookie contract shared by the middleware issuer and the server-side crypto
// helpers — kept free of Node-only imports so it can run in any runtime.
export const DEVICE_COOKIE = process.env.NODE_ENV === "production" ? "__Host-rm_device" : "rm_device";
export const DEVICE_TOKEN_RE = /^[a-f0-9]{64}$/;
export const DEVICE_COOKIE_MAX_AGE = 365 * 86400;
