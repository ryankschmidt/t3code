// ThroughLine: this app does not publish T3 Tools' legal documents as its own.
//
// These URLs used to fall back to https://t3.codes, so Settings -> Legal opened a page headed
// "T3 TOOLS, INC. / LEGAL" describing "T3 Code" — another company's terms, presented as this
// app's. Ryan saw exactly that on his iPhone on 2026-09-20.
//
// ThroughLine has no legal documents of its own yet, and inventing legal text is not something
// an agent may do. So the fallback is gone: with EXPO_PUBLIC_MARKETING_SITE_URL unset there are
// no legal documents, HAS_LEGAL_DOCUMENTS is false, and Settings hides the row entirely rather
// than showing someone else's. Set that variable to ThroughLine's own site to bring it back.
const DEFAULT_MARKETING_SITE_URL = "";

function resolveMarketingSiteUrl(override: string | undefined): URL | null {
  const candidate = override?.trim() || DEFAULT_MARKETING_SITE_URL;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url;
  } catch {
    return null;
  }
}

const MARKETING_SITE_URL = resolveMarketingSiteUrl(process.env.EXPO_PUBLIC_MARKETING_SITE_URL);

function marketingSiteDocumentUrl(path: string): string {
  return MARKETING_SITE_URL ? new URL(path, MARKETING_SITE_URL).toString() : "";
}

/** Whether this build has legal documents of its own to show at all. */
export const HAS_LEGAL_DOCUMENTS = MARKETING_SITE_URL !== null;

export const PRIVACY_POLICY_URL = marketingSiteDocumentUrl("privacy-policy");
export const SECURITY_POLICY_URL = marketingSiteDocumentUrl("security-policy");
export const TERMS_OF_SERVICE_URL = marketingSiteDocumentUrl("terms-of-service");
export const LEGAL_URL = marketingSiteDocumentUrl("legal");

export const ALLOWED_LEGAL_DOCUMENT_URLS = [
  LEGAL_URL,
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
  SECURITY_POLICY_URL,
].filter((value) => value !== "");

function webDocumentIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

const ALLOWED_LEGAL_DOCUMENT_IDENTITIES = new Set(
  ALLOWED_LEGAL_DOCUMENT_URLS.map(webDocumentIdentity).filter(
    (value): value is string => value !== null,
  ),
);

export function isLegalDocumentUrl(value: string): boolean {
  const identity = webDocumentIdentity(value);
  return identity !== null && ALLOWED_LEGAL_DOCUMENT_IDENTITIES.has(identity);
}
