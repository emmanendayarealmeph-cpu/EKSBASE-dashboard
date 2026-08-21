import express from "express";

import {
  loginWithDingTalk,
  logout,
  getCurrentUser,
} from "../controllers/dingtalkAuthController.js";

import {
  requireAuthenticatedUser,
} from "../auth/requireAuthenticatedUser.js";

const router =
  express.Router();

/*
 * Frontend posts the one-time DingTalk authCode here.
 *
 * POST /auth/dingtalk/login
 */
router.post(
  "/login",
  express.json(),
  loginWithDingTalk
);

/*
 * Current authenticated EKSBASE user.
 *
 * The dashboard session middleware must run before
 * requireAuthenticatedUser.
 */
router.get(
  "/me",
  requireAuthenticatedUser,
  getCurrentUser
);

router.post(
  "/logout",
  logout
);

export default router;
