import { getStandaloneUser } from "./standaloneAuth.js";
import { readDashboardSession } from "./dashboardSession.js";
import { getEmployeeByIdentity, getEmployeeAccess } from "./employeeAccess.js";
import { kingdeeService } from "../services/kingdeeService.js";

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

/*
 * Provider-neutral EKSBASE authentication middleware.
 *
 * Supported authentication sources:
 *   1. Standalone Employee No. + password bearer session
 *   2. Signed EKSBASE dashboard session cookie (DingTalk or future providers)
 *
 * Authentication identifies the employee.
 * Employee Access remains the EKSBASE authorization source.
 */
export function requireAuthenticatedUser(req, res, next) {
  try {
    const bearerToken = getBearerToken(req);
    const standaloneUser = getStandaloneUser(bearerToken);

    if (standaloneUser) {
      const kingdeeEmployee =
        await kingdeeService.getEmployeeByEmployeeNo(standaloneUser.employeeNo);

      if (!kingdeeEmployee) {
        return res.status(403).json({
          status: "error",
          message: "Your employee record was not found in the Kingdee Employee Master.",
          employeeNo: standaloneUser.employeeNo,
        });
      }

      // Kingdee is the authoritative source for employee active status.
      if (kingdeeEmployee.isActive !== true) {
        return res.status(403).json({
          status: "error",
          message: "Your Kingdee employee account is disabled.",
          employeeNo: standaloneUser.employeeNo,
        });
      }

      req.authenticatedIdentity = {
        provider: "standalone",
        providerSubject: standaloneUser.employeeNo,
        employeeNo: standaloneUser.employeeNo,
      };
      req.dashboardUser = standaloneUser;
      return next();
    }

    const session = readDashboardSession(req);

    if (!session?.employeeNo || !session?.provider) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required.",
      });
    }

    const kingdeeEmployee =
      await kingdeeService.getEmployeeByEmployeeNo(session.employeeNo);

    if (!kingdeeEmployee) {
      return res.status(403).json({
        status: "error",
        message: "Your employee record was not found in the Kingdee Employee Master.",
        employeeNo: session.employeeNo,
      });
    }

    // Kingdee is the authoritative source for employee active status.
    if (kingdeeEmployee.isActive !== true) {
      return res.status(403).json({
        status: "error",
        message: "Your Kingdee employee account is disabled.",
        employeeNo: session.employeeNo,
      });
    }

    const employee = session.provider === "dingtalk"
      ? getEmployeeAccess(session.employeeNo)
      : getEmployeeByIdentity({
          provider: session.provider,
          providerSubject: session.providerSubject,
        });

    if (!employee || Number(employee.isActive) !== 1) {
      return res.status(403).json({
        status: "error",
        message: "Your account is not registered for EKSBASE Dashboard access.",
      });
    }

    if (
      String(employee.employeeNo).trim() !==
      String(session.employeeNo).trim()
    ) {
      return res.status(403).json({
        status: "error",
        message: "Authenticated Employee No. does not match the EKSBASE Employee Access record.",
      });
    }

    req.authenticatedIdentity = {
      provider: String(session.provider).trim().toLowerCase(),
      providerSubject: String(session.providerSubject || "").trim(),
      employeeNo: String(session.employeeNo).trim(),
    };

    req.dashboardUser = {
      ...employee,
      employeeName: session.displayName || employee.employeeName || "",
      displayName: session.displayName || "",
      avatar: session.avatar || "",
    };

    return next();
  } catch (error) {
    return next(error);
  }
}
