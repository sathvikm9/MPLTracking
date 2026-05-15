const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const EXPECTED_AUDIENCE = "mpltracking-boxoffice-ingest";
const EXPECTED_REPOSITORY = "sathvikm9/MPLTracking";
const EXPECTED_REF = "refs/heads/MPLTracking";

let jwksCache = null;

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function decodeJwtPart(value) {
  return JSON.parse(base64UrlToBytes(value).toString("utf8"));
}

async function getJwks() {
  if (jwksCache) return jwksCache;

  const configResponse = await fetch(`${GITHUB_ISSUER}/.well-known/openid-configuration`);
  if (!configResponse.ok) {
    throw new Error("Unable to load GitHub OIDC configuration.");
  }

  const config = await configResponse.json();
  const jwksResponse = await fetch(config.jwks_uri);
  if (!jwksResponse.ok) {
    throw new Error("Unable to load GitHub OIDC keys.");
  }

  jwksCache = await jwksResponse.json();
  return jwksCache;
}

async function verifySignature(token, header) {
  const jwks = await getJwks();
  const key = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!key) {
    throw new Error("No matching GitHub OIDC signing key.");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["verify"]
  );
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = base64UrlToBytes(encodedSignature);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, data);

  if (!verified) {
    throw new Error("Invalid GitHub OIDC signature.");
  }
}

export async function verifyGithubActionsToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Missing GitHub OIDC token.");
  }

  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (payload.iss !== GITHUB_ISSUER) {
    throw new Error("Invalid GitHub OIDC issuer.");
  }

  if (payload.aud !== EXPECTED_AUDIENCE) {
    throw new Error("Invalid GitHub OIDC audience.");
  }

  if (payload.repository !== EXPECTED_REPOSITORY) {
    throw new Error("Invalid GitHub OIDC repository.");
  }

  if (payload.ref !== EXPECTED_REF) {
    throw new Error("Invalid GitHub OIDC branch.");
  }

  if (Number(payload.exp || 0) <= nowSeconds || Number(payload.nbf || 0) > nowSeconds + 60) {
    throw new Error("Expired or inactive GitHub OIDC token.");
  }

  await verifySignature(token, header);
  return payload;
}
