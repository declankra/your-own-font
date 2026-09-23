// The one server route: unsigned without certificates, signed S/MIME with them (SPEC.md §8.2).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { afterEach, describe, expect, test } from "vitest";
import { POST } from "../app/api/profile/route";

const otf = readFileSync(new URL("./fixtures/tiny.otf", import.meta.url));

function form(font: Uint8Array) {
  const body = new URLSearchParams({ font: Buffer.from(font).toString("base64"), name: "MyHand-TEST01" });
  return new Request("http://localhost/api/profile", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("/api/profile", () => {
  afterEach(() => {
    delete process.env.SIGN_CERT;
    delete process.env.SIGN_KEY;
    delete process.env.SIGN_CHAIN;
  });

  test("no certificate: an unsigned profile with one com.apple.font payload", async () => {
    const res = await POST(form(otf));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-apple-aspen-config");
    expect(res.headers.get("x-profile-signed")).toBe("no");
    const text = await res.text();
    expect(text).toContain("<string>com.apple.font</string>");
    expect(text.match(/com\.apple\.font/g)!.length).toBe(1);
    const data = text.match(/<data>([\s\S]*?)<\/data>/)![1].replace(/\s/g, "");
    expect(Buffer.from(data, "base64").equals(otf)).toBe(true);
  });

  test("rejects anything that isn't an OpenType CFF font", async () => {
    expect((await POST(form(new TextEncoder().encode("x".repeat(200))))).status).toBe(400);
  });

  test("with SIGN_CERT/SIGN_KEY/SIGN_CHAIN: S/MIME signed, and openssl verifies the signature", async () => {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 86400000);
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    const attrs = [{ name: "commonName", value: "yourownfont.test" }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const certPem = forge.pki.certificateToPem(cert);
    process.env.SIGN_CERT = Buffer.from(certPem).toString("base64");
    process.env.SIGN_KEY = Buffer.from(forge.pki.privateKeyToPem(keys.privateKey)).toString("base64");
    process.env.SIGN_CHAIN = Buffer.from(certPem).toString("base64");

    const res = await POST(form(otf));
    expect(res.headers.get("x-profile-signed")).toBe("yes");
    const der = new Uint8Array(await res.arrayBuffer());
    const dir = mkdtempSync(join(tmpdir(), "yof-"));
    writeFileSync(join(dir, "p.mobileconfig"), der);
    writeFileSync(join(dir, "ca.pem"), certPem);
    const plist = execFileSync("openssl", ["smime", "-verify", "-inform", "DER", "-in", join(dir, "p.mobileconfig"), "-CAfile", join(dir, "ca.pem"), "-purpose", "any"], {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    expect(plist).toContain("<string>com.apple.font</string>");
  });
});
