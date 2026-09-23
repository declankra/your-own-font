// The one server route (DECISIONS.md → Stack): wraps the person's font in an iOS configuration
// profile, signed in flight if the signing certificate is configured. The font is read from the
// request, wrapped, and sent straight back. It is never stored or logged.
import { checkFont, keysFromEnv, profilePlist, signProfile } from "@/lib/mobileconfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let font: Uint8Array;
  let name = "MyHand";
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("form")) {
      const form = await req.formData();
      font = Uint8Array.from(Buffer.from(String(form.get("font") ?? ""), "base64"));
      name = String(form.get("name") ?? name);
    } else {
      font = new Uint8Array(await req.arrayBuffer());
    }
  } catch {
    return new Response("Could not read the font.", { status: 400 });
  }
  const problem = checkFont(font);
  if (problem) return new Response(`That isn't a font we made (${problem}).`, { status: 400 });

  const plist = profilePlist(font, name);
  const keys = keysFromEnv();
  const body = keys ? signProfile(plist, keys) : new TextEncoder().encode(plist);
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/x-apple-aspen-config",
      "Content-Disposition": 'attachment; filename="My Hand.mobileconfig"',
      "Cache-Control": "no-store",
      "X-Profile-Signed": keys ? "yes" : "no",
    },
  });
}
