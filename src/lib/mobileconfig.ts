// iOS configuration profile with one font payload (com.apple.font), made in memory.
// Signed (S/MIME, DER) when SIGN_CERT, SIGN_KEY and SIGN_CHAIN are set, unsigned otherwise,
// with no code change (SPEC.md §8.2). Nothing is written anywhere.
import forge from "node-forge";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function uuid(): string {
  return crypto.randomUUID().toUpperCase();
}

export function profilePlist(font: Uint8Array, postScriptName: string): string {
  const b64 = Buffer.from(font).toString("base64").replace(/.{1,68}/g, "\t\t\t$&\n");
  const outer = uuid();
  const inner = uuid();
  const id = `font.yourown.${postScriptName.replace(/[^A-Za-z0-9-]/g, "")}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>Font</key>
			<data>
${b64}			</data>
			<key>Name</key>
			<string>My Hand.otf</string>
			<key>PayloadDisplayName</key>
			<string>My Hand</string>
			<key>PayloadIdentifier</key>
			<string>${esc(id)}.font</string>
			<key>PayloadType</key>
			<string>com.apple.font</string>
			<key>PayloadUUID</key>
			<string>${inner}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>Adds My Hand, a font of your own handwriting. It contains only the font.</string>
	<key>PayloadDisplayName</key>
	<string>My Hand (your handwriting)</string>
	<key>PayloadIdentifier</key>
	<string>${esc(id)}</string>
	<key>PayloadOrganization</key>
	<string>your own font</string>
	<key>PayloadRemovalDisallowed</key>
	<false/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>${outer}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
`;
}

export interface SigningKeys {
  cert: string; // PEM
  key: string; // PEM
  chain: string[]; // PEM, intermediates
}

/** Base64 env vars → PEMs. Returns null when any is missing (ship unsigned). */
export function keysFromEnv(env: Record<string, string | undefined> = process.env): SigningKeys | null {
  const { SIGN_CERT, SIGN_KEY, SIGN_CHAIN } = env;
  if (!SIGN_CERT || !SIGN_KEY || !SIGN_CHAIN) return null;
  const pem = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
  const chainPem = pem(SIGN_CHAIN);
  const chain = chainPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  return { cert: pem(SIGN_CERT), key: pem(SIGN_KEY), chain };
}

/** S/MIME SignedData (DER) over the profile, as iOS expects for a "Verified" profile. */
export function signProfile(plist: string, keys: SigningKeys): Uint8Array {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(plist, "utf8");
  const cert = forge.pki.certificateFromPem(keys.cert);
  p7.addCertificate(cert);
  for (const c of keys.chain) p7.addCertificate(forge.pki.certificateFromPem(c));
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(keys.key),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Uint8Array.from(der, (c) => c.charCodeAt(0));
}

export const MAX_FONT_BYTES = 1_500_000;

/** Checks the upload is an OpenType CFF font of a sane size. */
export function checkFont(bytes: Uint8Array): string | null {
  if (bytes.length < 64) return "too small";
  if (bytes.length > MAX_FONT_BYTES) return "too large";
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag !== "OTTO") return "not an OpenType font";
  return null;
}
