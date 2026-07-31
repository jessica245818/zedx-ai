import { clearMailboxCookie } from "../_shared";

export async function POST() {
  return Response.json({ disconnected: true }, { headers: { "Set-Cookie": clearMailboxCookie() } });
}
