import { getStandaloneUser } from "./standaloneAuth.js";

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authorization.slice(7).trim();
}

export function requireAuthenticatedUser(req, res, next) {
  const token = getBearerToken(req);
  const user = getStandaloneUser(token);

  if (!user) {
    return res.status(401).json({
      status: "error",
      message: "Authentication required.",
    });
  }

  req.authenticatedIdentity = {
    provider: "standalone",
    providerSubject: user.employeeNo,
    employeeNo: user.employeeNo,
  };

  req.dashboardUser = user;

  return next();
}
