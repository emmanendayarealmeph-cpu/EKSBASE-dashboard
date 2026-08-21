import {
  getEmployeeByIdentity,
} from "./employeeAccess.js";

/*
 * Provider-neutral authorization middleware.
 *
 * Authentication providers populate req.authenticatedIdentity:
 *
 * {
 *   provider: "dingtalk",
 *   subject: "provider-specific-user-id",
 *   employeeNo: "1913444"
 * }
 *
 * The middleware then resolves the internal EKSBASE employee/access
 * record. Authorization does not depend on the provider.
 */

export async function requireAuthenticatedUser(
  req,
  res,
  next
) {
  try {
    const identity =
      req.authenticatedIdentity;

    if (!identity) {
      return res.status(401).json({
        error: "Authentication required.",
      });
    }

    const employee =
      getEmployeeByIdentity({
        provider: identity.provider,
        providerSubject: identity.subject,
      });

    if (!employee || !employee.isActive) {
      return res.status(403).json({
        error:
          "Your account is not registered for EKSBASE Dashboard access.",
      });
    }

    /*
     * Identity reconciliation rule:
     *
     * Provider employee number must equal Kingdee Employee No.
     */
    if (
      String(employee.employeeNo).trim() !==
      String(identity.employeeNo).trim()
    ) {
      return res.status(403).json({
        error:
          "Authenticated Employee No. does not match the Kingdee Employee No.",
      });
    }

    req.dashboardUser = employee;
    req.authenticatedIdentity = identity;

    next();
  } catch (error) {
    next(error);
  }
}
