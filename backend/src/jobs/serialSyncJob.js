import { kingdeeService } from "../services/kingdeeService.js";

let intervalHandle = null;

export function startSerialSyncJob({
  intervalMinutes = 15,
  limit = 500,
} = {}) {
  const parsedIntervalMinutes = Math.max(
    Number.parseInt(intervalMinutes, 10) || 30,
    1
  );

  const intervalMs =
    parsedIntervalMinutes *
    60 *
    1000;

  const runSync = async () => {
    try {
      const state =
        kingdeeService.getSerialSyncState();

      if (state.running) {
        console.log(
          "[SYNC JOB] Skipped because a serial sync is already running."
        );

        return;
      }

      console.log(
      "[SYNC JOB] Starting automatic Warehouse Delivery serial sync..."
);

      const result =
        await kingdeeService.syncWarehouseDeliverySerialData({
          limit,
        });

      if (result?.skipped) {
        console.log(
          `[SYNC JOB] Skipped: ${result.reason}`
        );

        return;
      }

      console.log(
        `[SYNC JOB] Complete | Fetched ${result.totalFetched} | Saved ${result.totalSaved}`
      );
    } catch (error) {
      console.error(
        "[SYNC JOB] Automatic serial sync failed:",
        error
      );
    }
  };

  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  intervalHandle =
    setInterval(
      runSync,
      intervalMs
    );

  console.log(
    `[SYNC JOB] Serial sync scheduled every ${parsedIntervalMinutes} minute(s) | Org 110 | Stock Status Warehouse Delivery`
  );

  // Run once at startup so a fresh Render instance does not wait 15 minutes
  // before the local sell-out dataset is populated/refreshed.
  void runSync();

  return {
    intervalMinutes:
      parsedIntervalMinutes,
  };
}

export function stopSerialSyncJob() {
  if (!intervalHandle) {
    return false;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;

  console.log(
    "[SYNC JOB] Serial sync scheduler stopped."
  );

  return true;
}