import db from "../db.server";
import { PLAN_LIMITS, UNLIMITED, type PlanTier } from "../plans";

export interface CheckUsage {
  used: number;
  limit: number;
  percent: number;
  overLimit: boolean;
  unlimited: boolean;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Returns first day of the current UTC month. Customer-check quota resets
 * on the 1st of every month at 00:00 UTC.
 */
export function getMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function getMonthEnd(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

export async function getMonthlyCheckUsage(
  shop: string,
  planTier: PlanTier,
): Promise<CheckUsage> {
  const limits = PLAN_LIMITS[planTier];
  const limit = limits.maxChecksPerMonth;
  const unlimited = limit >= UNLIMITED;
  const periodStart = getMonthStart();
  const periodEnd = getMonthEnd();

  const used = await db.zipCheckLog.count({
    where: { shop, createdAt: { gte: periodStart, lt: periodEnd } },
  });

  const percent = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const overLimit = !unlimited && used >= limit;

  return { used, limit, percent, overLimit, unlimited, periodStart, periodEnd };
}
