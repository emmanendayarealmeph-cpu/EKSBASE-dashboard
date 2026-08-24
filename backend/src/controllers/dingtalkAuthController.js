import {
  authenticateDingTalk,
} from "../auth/dingtalkAuthService.js";

import {
  setDashboardSession,
  clearDashboardSession,
} from "../auth/dashboardSession.js";

import {
  getEmployeeAccess,
} from "../auth/employeeAccess.js";

import {
  kingdeeService,
} from "../services/kingdeeService.js";

export async function loginWithDingTalk(req, res, next) {
  const startedAt = performance.now();

  try {
    const authCode = String(req.body?.authCode || "").trim();

    if (!authCode) {
      return res.status(400).json({
        status: "error",
        message: "authCode is required.",
      });
    }

    console.log("[DINGTALK SSO] Authentication START");

    const identity = await authenticateDingTalk(authCode);

    console.log(
      `[DINGTALK SSO] Identity resolved +${Math.round(performance.now() - startedAt)}ms | employeeNo=${identity.employeeNo}`
    );

    /*
     * Critical identity rule:
     * DingTalk Job Number = Kingdee Employee No.
     *
     * Validate the Job Number against Kingdee itself. We do not
     * accept an Employee No. supplied by the browser and we do not
     * require a manually-created DingTalk identity mapping.
     */
    const kingdeeEmployee =
      await kingdeeService.getEmployeeByEmployeeNo(identity.employeeNo);

    if (!kingdeeEmployee) {
      return res.status(403).json({
        status: "error",
        message: "Your DingTalk Job Number was not found in the Kingdee Employee Master.",
        employeeNo: identity.employeeNo,
      });
    }

    // Kingdee is the authoritative source for whether the employee is active.
    // FForbidStatus = true  -> disabled -> deny authentication.
    // FForbidStatus = false -> active   -> continue to EKSBASE authorization.
    if (kingdeeEmployee.isActive !== true) {
      return res.status(403).json({
        status: "error",
        message: "Your Kingdee employee account is disabled.",
        employeeNo: identity.employeeNo,
      });
    }

    const employee = getEmployeeAccess(identity.employeeNo);

    if (!employee || Number(employee.isActive) !== 1) {
      return res.status(403).json({
        status: "error",
        message: "Your Kingdee employee account is not configured for EKSBASE Dashboard access.",
        employeeNo: identity.employeeNo,
      });
    }

    if (
      String(kingdeeEmployee.salesNo || "").trim().toUpperCase() !==
      String(identity.employeeNo).trim().toUpperCase()
    ) {
      return res.status(403).json({
        status: "error",
        message: "DingTalk Job Number does not match the Kingdee Employee No.",
      });
    }

    /*
     * Preserve the existing EKSBASE authorization model.
     * DingTalk proves identity; employee_access controls access.
     */
    setDashboardSession(res, {
      ...identity,
      providerSubject: identity.providerSubject,
    });

    console.log(
      `[DINGTALK SSO] Authentication COMPLETE +${Math.round(performance.now() - startedAt)}ms | employeeNo=${identity.employeeNo}`
    );

    return res.json({
      status: "ok",
      provider: "dingtalk",
      user: {
        employeeNo: employee.employeeNo,
        role: employee.role,
        department: employee.department,
        accessLevel: employee.accessLevel,
        district: employee.district,
        region: employee.region,
        subRegion: employee.subRegion,
        warehouseCode: employee.warehouseCode,
        displayName: identity.displayName || kingdeeEmployee.employeeName || "",
        avatar: identity.avatar || "",
      },
    });
  } catch (error) {
    console.error(
      `[DINGTALK SSO] Authentication FAILED +${Math.round(performance.now() - startedAt)}ms:`,
      error?.message || error
    );
    return next(error);
  }
}

export function logout(_req, res) {
  clearDashboardSession(res);

  return res.json({
    status: "ok",
  });
}

export function getCurrentUser(req, res) {
  if (!req.dashboardUser) {
    return res.status(401).json({
      status: "error",
      message: "Authentication required.",
    });
  }

  return res.json({
    status: "ok",
    provider: req.authenticatedIdentity?.provider || "",
    user: req.dashboardUser,
  });
}
