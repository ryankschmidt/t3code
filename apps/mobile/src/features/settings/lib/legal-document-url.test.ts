import { describe, expect, it } from "vite-plus/test";

import { HAS_LEGAL_DOCUMENTS, isLegalDocumentUrl } from "./legal-document-url";

// ThroughLine: this app has no legal documents of its own yet, and it must not present another
// company's as if they were. The previous contract hard-coded https://t3.codes as the fallback
// marketing site, so Settings -> Legal opened a page headed "T3 TOOLS, INC. / LEGAL" describing
// "T3 Code". These tests now assert the opposite: with no site configured there are no legal
// documents at all, and nothing is allow-listed.
//
// EXPO_PUBLIC_MARKETING_SITE_URL is read once at module load, so these tests cover the
// unconfigured build — which is every build until ThroughLine publishes its own documents.

describe("legal documents, unconfigured", () => {
  it("reports that this build has no legal documents", () => {
    expect(HAS_LEGAL_DOCUMENTS).toBe(false);
  });

  it.each([
    "https://t3.codes/legal",
    "https://t3.codes/legal/",
    "https://t3.codes/privacy-policy?source=app",
    "https://t3.codes/terms-of-service#updates",
    "https://t3.codes/security-policy",
  ])("does not treat another company's legal page as this app's: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(false);
  });
});

describe("isLegalDocumentUrl", () => {
  it.each([
    "https://t3.codes/download",
    "https://example.com/legal",
    "javascript:alert(1)",
    "not-a-url",
  ])("rejects a URL outside the legal-document allowlist: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(false);
  });
});
