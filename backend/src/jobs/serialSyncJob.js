import { kingdeeService } from "../services/kingdeeService.js";

let intervalHandle = null;

export function startSerialSyncJob({
  intervalMinutes = 30,
  days = 1,
  limit = 100,
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
        "[SYNC JOB] Starting automatic recent serial sync..."
      );

      const result =
        await kingdeeService.syncRecentSerialData({
          days,
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
    `[SYNC JOB] Serial sync scheduled every ${parsedIntervalMinutes} minute(s).`
  );

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