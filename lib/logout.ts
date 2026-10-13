import dayjs from "dayjs";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { authApi, partnerApi } from "./api";
import { cancelDailyDutyReminders } from "./dutyReminders";
import { LOCATION_TASK_NAME } from "./locationTask";

// =========================================================
// FORMAT MINUTES
// =========================================================

export const formatMinutesToHours = (
  totalMinutes: number | string,
) => {
  const minsNum = Math.max(
    0,
    parseInt(String(totalMinutes || 0), 10) || 0,
  );

  if (minsNum === 0) {
    return "0 min";
  }

  const hours = Math.floor(minsNum / 60);
  const mins = minsNum % 60;

  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins} min`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${mins} min`;
};

// =========================================================
// SPLIT SESSION LOGS
//
// Kept as a utility because other frontend code may still
// use it for displaying/calculating local values.
//
// IMPORTANT:
// This function NO LONGER writes anything to Supabase.
// Database persistence is handled by FastAPI.
// =========================================================

export const splitAndAddSessionLogs = (
  existingLogs: Record<string, number> = {},
  startedAtStr: string,
  endedAtStr: string,
) => {
  const start = dayjs(startedAtStr);
  const end = dayjs(endedAtStr);

  if (
    !start.isValid() ||
    !end.isValid() ||
    !end.isAfter(start)
  ) {
    return {
      ...existingLogs,
    };
  }

  const updatedLogs = {
    ...existingLogs,
  };

  let currentCursor = start.clone();

  while (currentCursor.isBefore(end)) {
    const currentDayKey =
      currentCursor.format("YYYY-MM-DD");

    const endOfCurrentDay =
      currentCursor.endOf("day");

    const chunkEnd = end.isBefore(
      endOfCurrentDay,
    )
      ? end
      : endOfCurrentDay;

    const chunkMins = Math.max(
      0,
      chunkEnd.diff(
        currentCursor,
        "minute",
      ),
    );

    if (chunkMins > 0) {
      const prevMins = Number(
        updatedLogs[currentDayKey] || 0,
      );

      updatedLogs[currentDayKey] =
        prevMins + chunkMins;
    }

    currentCursor = currentCursor
      .add(1, "day")
      .startOf("day");
  }

  return updatedLogs;
};

// =========================================================
// CALCULATE DUTY TOTALS
//
// Frontend calculation utility only.
// FastAPI is the source of truth for saved duty totals.
// =========================================================

export const calculateDutyTotals = (
  logs: Record<string, number> = {},
  active: boolean = false,
  startedAt: string | null = null,
) => {
  const todayKey =
    dayjs().format("YYYY-MM-DD");

  const currentMonthKey =
    dayjs().format("YYYY-MM");

  // -------------------------------------------------------
  // Standard Calendar Week
  // Monday 00:00 -> Sunday 23:59
  // -------------------------------------------------------

  const now = dayjs();

  const dayOfWeek = now.day();

  // 0 = Sunday
  // 1 = Monday
  // ...
  // 6 = Saturday

  const diffToMonday =
    dayOfWeek === 0
      ? 6
      : dayOfWeek - 1;

  const startOfWeek = now
    .subtract(
      diffToMonday,
      "day",
    )
    .startOf("day");

  const endOfWeek = startOfWeek
    .add(6, "day")
    .endOf("day");

  // -------------------------------------------------------
  // Base totals
  // -------------------------------------------------------

  let todayBase = Number(
    logs[todayKey] || 0,
  );

  let weeklyBase = 0;

  let monthlyBase = 0;

  // -------------------------------------------------------
  // Process existing logs
  // -------------------------------------------------------

  Object.entries(logs).forEach(
    ([dateStr, mins]) => {
      const minVal =
        Number(mins) || 0;

      const d = dayjs(dateStr);

      if (!d.isValid()) {
        return;
      }

      // Weekly
      if (
        (
          d.isSame(
            startOfWeek,
            "day",
          ) ||
          d.isAfter(
            startOfWeek,
          )
        ) &&
        (
          d.isSame(
            endOfWeek,
            "day",
          ) ||
          d.isBefore(
            endOfWeek,
          )
        )
      ) {
        weeklyBase += minVal;
      }

      // Monthly
      if (
        dateStr.startsWith(
          currentMonthKey,
        )
      ) {
        monthlyBase += minVal;
      }
    },
  );

  // -------------------------------------------------------
  // Active session values
  // -------------------------------------------------------

  let todayActiveMins = 0;

  let weeklyActiveMins = 0;

  let monthlyActiveMins = 0;

  if (
    active &&
    startedAt
  ) {
    const start =
      dayjs(startedAt);

    if (
      start.isValid() &&
      now.isAfter(start)
    ) {
      // -----------------------------------------------
      // Today
      // -----------------------------------------------

      const startOfToday =
        now.startOf("day");

      const effectiveTodayStart =
        start.isAfter(
          startOfToday,
        )
          ? start
          : startOfToday;

      todayActiveMins =
        Math.max(
          0,
          now.diff(
            effectiveTodayStart,
            "minute",
          ),
        );

      // -----------------------------------------------
      // Week
      // -----------------------------------------------

      const effectiveWeeklyStart =
        start.isAfter(
          startOfWeek,
        )
          ? start
          : startOfWeek;

      weeklyActiveMins =
        Math.max(
          0,
          now.diff(
            effectiveWeeklyStart,
            "minute",
          ),
        );

      // -----------------------------------------------
      // Month
      // -----------------------------------------------

      const startOfMonth =
        now.startOf("month");

      const effectiveMonthlyStart =
        start.isAfter(
          startOfMonth,
        )
          ? start
          : startOfMonth;

      monthlyActiveMins =
        Math.max(
          0,
          now.diff(
            effectiveMonthlyStart,
            "minute",
          ),
        );
    }
  }

  return {
    today:
      todayBase +
      todayActiveMins,

    weekly:
      weeklyBase +
      weeklyActiveMins,

    monthly:
      monthlyBase +
      monthlyActiveMins,
  };
};

// =========================================================
// TURN OFF DUTY + LOGOUT
//
// IMPORTANT:
//
// The Partner App does NOT:
//
// ❌ access Supabase
// ❌ access staff_profile
// ❌ calculate/save duty in database
// ❌ call supabase.auth.getUser()
// ❌ call supabase.auth.getSession()
// ❌ call supabase.auth.signOut()
//
// Instead:
//
// Partner App
//      |
//      | POST /api/v1/partner/duty/off
//      v
// FastAPI
//      |
//      +--> identify partner from Bearer token
//      +--> finalize duty
//      +--> update staff_profile
//      +--> save duty logs
//      |
//      | POST /api/v1/auth/logout
//      v
// FastAPI
// =========================================================

export async function turnOffDutyAndLogout(_userId?: string) {
  try {
    // =====================================================
    // 1. TURN OFF DUTY THROUGH FASTAPI
    // =====================================================

    try {
      const response =
        await partnerApi.turnOffDuty();

      console.log(
        "✅ Backend duty off:",
        response,
      );
    } catch (error) {
      console.error(
        "❌ Backend duty-off failed:",
        error,
      );

      // We continue with local cleanup.
    }

    // =====================================================
    // 2. CANCEL DAILY DUTY REMINDERS
    // =====================================================

    try {
      await cancelDailyDutyReminders();

      console.log(
        "🛑 Daily duty reminders cancelled.",
      );
    } catch (error) {
      console.log(
        "Error cancelling daily duty reminders:",
        error,
      );
    }

    // =====================================================
    // 3. STOP BACKGROUND LOCATION TRACKING
    // =====================================================

    try {
      const isRegistered =
        await TaskManager.isTaskRegisteredAsync(
          LOCATION_TASK_NAME,
        );

      if (isRegistered) {
        await Location.stopLocationUpdatesAsync(
          LOCATION_TASK_NAME,
        );

        console.log(
          "🛑 Background location tracking stopped.",
        );
      }
    } catch (error) {
      console.log(
        "Error stopping location task:",
        error,
      );
    }

    // =====================================================
    // 4. LOGOUT THROUGH FASTAPI
    // =====================================================

    try {
      const response =
        await authApi.logout();

      console.log(
        "✅ FastAPI logout successful:",
        response,
      );
    } catch (error) {
      console.error(
        "❌ FastAPI logout failed:",
        error,
      );
    }
  } catch (error) {
    console.error(
      "❌ Error during logout cleanup:",
      error,
    );
  }
}