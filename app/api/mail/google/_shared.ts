const COOKIE = "zedx_google_mailbox";
const STATE = "zedx_google_state";
export const GOOGLE_CLIENT_ID = "276798839321-d2qtoru8eal9kna4m048ohbu8srcg9te.apps.googleusercontent.com";

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const base64ToBytes = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
const cookieValue = (request: Request, name: string) => request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);

async function key() {
  const material = `${process.env.GOOGLE_CLIENT_SECRET}:${process.env.ZEDX_COOKIE_SECRET}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(value: object) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(value)));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decrypt<T>(value?: string) {
  try {
    if (!value) return null;
    const [iv, payload] = value.split(".");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await key(), base64ToBytes(payload));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch { return null; }
}

export const getGoogleSession = <T>(request: Request) => decrypt<T>(cookieValue(request, COOKIE));
export const getGoogleState = (request: Request) => cookieValue(request, STATE);
export const googleCookie = (value: string) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
export const clearGoogleCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export const googleStateCookie = (value: string) => `${STATE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
export const clearGoogleStateCookie = () => `${STATE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
