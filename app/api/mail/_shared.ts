export type ConnectedMailbox = {
  grantId: string;
  email: string;
  provider: string;
};

const COOKIE_NAME = "zedx_mailbox";
const STATE_COOKIE = "zedx_oauth_state";

function encode(value: string) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

async function signature(value: string) {
  const secret = process.env.ZEDX_COOKIE_SECRET;
  if (!secret) throw new Error("ZEDX_COOKIE_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encode(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))));
}

export async function seal(value: object) {
  const payload = encode(JSON.stringify(value));
  return `${payload}.${await signature(payload)}`;
}

export async function unseal<T>(sealed: string | undefined): Promise<T | null> {
  if (!sealed) return null;
  const [payload, supplied] = sealed.split(".");
  if (!payload || !supplied || (await signature(payload)) !== supplied) return null;
  try {
    return JSON.parse(decode(payload)) as T;
  } catch {
    return null;
  }
}

export function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function mailboxFrom(request: Request) {
  return unseal<ConnectedMailbox>(cookieValue(request, COOKIE_NAME));
}

export function mailboxCookie(value: string) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

export function clearMailboxCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function stateCookie(value: string) {
  return `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function clearStateCookie() {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function oauthStateFrom(request: Request) {
  return cookieValue(request, STATE_COOKIE);
}

export function apiBase() {
  return process.env.NYLAS_API_URI || "https://api.us.nylas.com";
}

export function configurationReady() {
  return Boolean(process.env.NYLAS_CLIENT_ID && process.env.NYLAS_API_KEY && process.env.ZEDX_COOKIE_SECRET);
}
