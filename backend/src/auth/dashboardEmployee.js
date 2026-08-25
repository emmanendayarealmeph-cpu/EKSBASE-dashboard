import { db } from "../database/database.js";
import { kingdeeService } from "../services/kingdeeService.js";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeDepartment(value) {
  const department = clean(value).toUpperCase();
  if (department === "SUB-REGION") return "SUB_REGION";
  if (department === "SUB REGION") return "SUB_REGION";
  return department;
}

function resolveHierarchyFromDepartment(department) {
  const normalizedDepartment = normalizeDepartment(department);

  if (!normalizedDepartment) {
    return {
      accessLevel: "NONE",
      district: "",
      region: "",
      subRegion: "",
    };
  }

  const row = db.prepare(`
    SELECT
      MAX(CASE
        WHEN UPPER(TRIM(sub_region)) = UPPER(TRIM(?))
        THEN sub_region
      END) AS subRegion,
      MAX(CASE
        WHEN UPPER(TRIM(region)) = UPPER(TRIM(?))
        THEN region
      END) AS region,
      MAX(CASE
        WHEN UPPER(TRIM(district)) = UPPER(TRIM(?))
        THEN district
      END) AS district
    FROM serial_main_file
    WHERE
      TRIM(COALESCE(sub_region, '')) <> ''
      OR TRIM(COALESCE(region, '')) <> ''
      OR TRIM(COALESCE(district, '')) <> ''
  `).get(
    normalizedDepartment,
    normalizedDepartment,
    normalizedDepartment
  );

  if (row?.subRegion) {
    return {
      accessLevel: "SUB_REGION",
      district: "",
      region: "",
      subRegion: clean(row.subRegion),
    };
  }

  if (row?.region) {
    return {
      accessLevel: "REGION",
      district: "",
      region: clean(row.region),
      subRegion: "",
    };
  }

  if (row?.district) {
    return {
      accessLevel: "DISTRICT",
      district: clean(row.district),
      region: "",
      subRegion: "",
    };
  }

  return {
    accessLevel: "NONE",
    district: "",
    region: "",
    subRegion: "",
  };
}

/**
 * Kingdee Employee Master is the sole employee/access source.
 *
 * Authentication providers only identify the Employee No.
 * This function resolves the current Kingdee employee and the
 * dashboard hierarchy from the local serial-main hierarchy data.
 *
 * No employee_access table, user_identities table, or Neon database
 * is consulted.
 */
export async function getDashboardEmployee(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return null;

  const startedAt = performance.now();
  console.log(
    `[AUTH] Kingdee employee lookup START | employeeNo=${normalizedEmployeeNo}`
  );

  const kingdeeEmployee =
    await kingdeeService.getEmployeeByEmployeeNo(normalizedEmployeeNo);

  console.log(
    `[AUTH] Kingdee employee lookup COMPLETE | employeeNo=${normalizedEmployeeNo} | duration=${Math.round(performance.now() - startedAt)}ms | found=${Boolean(kingdeeEmployee)}`
  );

  if (!kingdeeEmployee) return null;

  const kingdeeEmployeeNo = clean(kingdeeEmployee.salesNo);
  if (
    kingdeeEmployeeNo.toUpperCase() !==
    normalizedEmployeeNo.toUpperCase()
  ) {
    return null;
  }

  if (kingdeeEmployee.isActive !== true) {
    return {
      employeeNo: normalizedEmployeeNo,
      employeeName: clean(kingdeeEmployee.employeeName),
      isActive: 0,
      disabled: true,
    };
  }

  const role = clean(kingdeeEmployee.role || "STAFF").toUpperCase();
  const department = normalizeDepartment(kingdeeEmployee.department);

  const hierarchy =
    role === "PROMOTER"
      ? {
          accessLevel: "PROMOTER",
          district: "",
          region: "",
          subRegion: "",
        }
      : resolveHierarchyFromDepartment(department);

  return {
    employeeNo: normalizedEmployeeNo,
    employeeName: clean(kingdeeEmployee.employeeName),
    role,
    department: department || "NONE",
    accessLevel: hierarchy.accessLevel,
    district: hierarchy.district,
    region: hierarchy.region,
    subRegion: hierarchy.subRegion,
    warehouseCode: "",
    salesNo: role === "PROMOTER" ? normalizedEmployeeNo : "",
    isActive: 1,
    organizationCode: "110",
    disabled: false,
  };
}
