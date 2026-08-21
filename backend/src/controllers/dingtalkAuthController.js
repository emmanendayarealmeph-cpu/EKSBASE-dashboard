import {
  authenticateDingTalk,
} from "../auth/dingtalkAuthService.js";

import {
  setDashboardSession,
  clearDashboardSession,
} from "../auth/dashboardSession.js";

import {
  getEmployeeByIdentity,
} from "../auth/employeeAccess.js";

export async function loginWithDingTalk(
  req,
  res,
  next
) {
  try {
    const authCode =
      req.body?.authCode;

    if (!authCode) {
      return res.status(400).json({
        error:
          "authCode is required.",
      });
    }

    const identity =
      await authenticateDingTalk(
        authCode
      );

    /*
     * IMPORTANT:
     * Authentication does not grant dashboard access.
     *
     * The employee must already exist in EKSBASE
     * Employee Access.
     */
    const employee =
      getEmployeeByIdentity({
        provider:
          identity.provider,
        providerSubject:
          identity.providerSubject,
      });

    /*
     * The identity mapping may not exist on first login.
     *
     * For the first Phase 2 implementation, require the
     * administrator to provision the employee in
     * employee_access/user_identities.
     *
     * This prevents an arbitrary DingTalk employee from
     * becoming a dashboard user automatically.
     */
    if (!employee || !employee.isActive) {
      return res.status(403).json({
        error:
          "DingTalk account authenticated, but no active EKSBASE Employee Access record was found.",
        employeeNo:
          identity.employeeNo,
      });
    }

    /*
     * Defense-in-depth identity check.
     */
    if (
      String(
        employee.employeeNo
      ).trim() !==
      String(
        identity.employeeNo
      ).trim()
    ) {
      return res.status(403).json({
        error:
          "DingTalk Job Number does not match Kingdee Employee No.",
      });
    }

    setDashboardSession(
      res,
      identity
    );

    return res.json({
      status: "ok",

      user: {
        employeeNo:
          employee.employeeNo,
        role:
          employee.role,
        accessLevel:
          employee.accessLevel,
        district:
          employee.district,
        region:
          employee.region,
        subRegion:
          employee.subRegion,
        warehouseCode:
          employee.warehouseCode,
        displayName:
          identity.displayName,
        avatar:
          identity.avatar,
      },
    });
  } catch (error) {
    next(error);
  }
}

export function logout(
  _req,
  res
) {
  clearDashboardSession(res);

  return res.json({
    status: "ok",
  });
}

export function getCurrentUser(
  req,
  res
) {
  if (!req.dashboardUser) {
    return res.status(401).json({
      error:
        "Authentication required.",
    });
  }

  return res.json({
    status: "ok",
    user: {
      employeeNo:
        req.dashboardUser.employeeNo,
      role:
        req.dashboardUser.role,
      accessLevel:
        req.dashboardUser.accessLevel,
      district:
        req.dashboardUser.district,
      region:
        req.dashboardUser.region,
      subRegion:
        req.dashboardUser.subRegion,
      warehouseCode:
        req.dashboardUser.warehouseCode,
    },
  });
}
