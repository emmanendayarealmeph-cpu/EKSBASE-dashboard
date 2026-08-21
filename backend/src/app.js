import express from "express";
import healthRouter from "./routes/health.js";
import kingdeeRouter from "./routes/kingdee.js";
import dashboardRouter from "./routes/dashboard.js";
import standaloneAuthRouter from "./routes/standaloneAuth.js";
import { requireAuthenticatedUser } from "./auth/requireAuthenticatedUser.js";

const app = express();

/*
 * CORS
 *
 * Allows the local frontend to communicate with
 * the backend API during development.
 *
 * Frontend:
 * http://localhost:3001
 *
 * Backend:
 * http://localhost:3000
 */
app.use((req, res, next) => {
  res.header(
    "Access-Control-Allow-Origin",
    "http://localhost:3001"
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Kingdee Data Platform API is running 🚀",
  });
});

app.use("/health", healthRouter);
app.use("/kingdee", kingdeeRouter);

// Phase 3A: standalone development authentication.
app.use("/auth/standalone", standaloneAuthRouter);

// Phase 3A: dashboard is now authenticated before authorization runs.
app.use("/dashboard", requireAuthenticatedUser, dashboardRouter);

export default app;
