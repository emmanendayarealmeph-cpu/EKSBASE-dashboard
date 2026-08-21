import crypto from "node:crypto";

const COOKIE_NAME =
  "eksbase_session";

const DEFAULT_TTL_SECONDS =
  8 * 60 * 60;

function requiredSecret() {
  const secret =
    process.env.EKSBASE_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "EKSBASE_SESSION_SECRET must be set and contain at least 32 characters."
    );
  }

  return secret;
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(value) {
  const padded =
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/") +
    "===".slice(
      (value.length + 3) % 4
    );

  return Buffer.from(
    padded,
    "base64"
  );
}

function sign(value) {
  return base64url(
    crypto
      .createHmac(
        "sha256",
        requiredSecret()
      )
      .update(value)
      .digest()
  );
}

function safeEqual(a, b) {
  const left =
    Buffer.from(a);
  const right =
    Buffer.from(b);

  if (
    left.length !==
    right.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    left,
    right
  );
}

function serialize(payload) {
  const encoded =
    base64url(
      JSON.stringify(payload)
    );

  return `${encoded}.${sign(encoded)}`;
}

function deserialize(value) {
  if (!value) return null;

  const dot =
    value.lastIndexOf(".");

  if (dot <= 0) return null;

  const encoded =
    value.slice(0, dot);

  const signature =
    value.slice(dot + 1);

  const expected =
    sign(encoded);

  if (
    !safeEqual(
      signature,
      expected
    )
  ) {
    return null;
  }

  try {
    const payload =
      JSON.parse(
        fromBase64url(
          encoded
        ).toString("utf8")
      );

    if (
      !payload.exp ||
      payload.exp <
        Math.floor(
          Date.now() / 1000
        )
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const cookies = {};

  for (
    const part of String(
      header || ""
    ).split(";")
  ) {
    const index =
      part.indexOf("=");

    if (index < 0) continue;

    const name =
      part
        .slice(0, index)
        .trim();

    const value =
      part
        .slice(index + 1)
        .trim();

    if (name) {
      cookies[name] =
        decodeURIComponent(
          value
        );
    }
  }

  return cookies;
}

export function setDashboardSession(
  res,
  user,
  options = {}
) {
  const ttl =
    Number(
      options.ttlSeconds ||
      process.env.EKSBASE_SESSION_TTL_SECONDS ||
      DEFAULT_TTL_SECONDS
    );

  const now =
    Math.floor(
      Date.now() / 1000
    );

  const payload = {
    v: 1,
    iat: now,
    exp: now + ttl,

    provider:
      user.provider,

    providerSubject:
      user.providerSubject,

    employeeNo:
      user.employeeNo,

    dingtalkUserId:
      user.dingtalkUserId,

    displayName:
      user.displayName,

    avatar:
      user.avatar,
  };

  const value =
    serialize(payload);

  const secure =
    process.env.NODE_ENV ===
    "production";

  const cookieParts = [
    `${COOKIE_NAME}=${encodeURIComponent(
      value
    )}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${ttl}`,
  ];

  if (secure) {
    cookieParts.push(
      "Secure"
    );
  }

  res.setHeader(
    "Set-Cookie",
    cookieParts.join("; ")
  );
}

export function clearDashboardSession(
  res
) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );
}

export function readDashboardSession(
  req
) {
  const cookies =
    parseCookies(
      req.headers.cookie
    );

  return deserialize(
    cookies[COOKIE_NAME]
  );
}

/**
 * Loads the signed identity into req.authenticatedIdentity.
 *
 * The actual Employee Access record is resolved later by
 * requireAuthenticatedUser.
 */
export function dashboardSessionMiddleware(
  req,
  _res,
  next
) {
  const session =
    readDashboardSession(req);

  if (session) {
    req.authenticatedIdentity = {
      provider:
        session.provider,

      providerSubject:
        session.providerSubject,

      employeeNo:
        session.employeeNo,
    };
  }

  next();
}
