import { getGoogleSession } from "../_shared";
export async function GET(request: Request) {
  const session = await getGoogleSession<{ email: string }>(request);
  return Response.json(session ? { connected: true, email: session.email, provider: "Google" } : { connected: false });
}
