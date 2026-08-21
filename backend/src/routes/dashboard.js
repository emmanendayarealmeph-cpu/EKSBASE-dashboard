import { Router } from "express";
import { dashboardController } from "../controllers/dashboardController.js";
import { requireAuthenticatedUser } from "../auth/requireAuthenticatedUser.js";

const router = Router();

/*
 * All dashboard endpoints require an authenticated employee.
 *
 * The middleware resolves the authenticated identity and sets:
 *   req.dashboardUser
 *
 * Authorization remains server-controlled.
 */

router.get(
  "/summary",
  requireAuthenticatedUser,
  dashboardController.getSummary
);

router.get(
  "/search",
  requireAuthenticatedUser,
  dashboardController.search
);

router.get(
  "/export",
  requireAuthenticatedUser,
  dashboardController.exportReport
);

export default router;
