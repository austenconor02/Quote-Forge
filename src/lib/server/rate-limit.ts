import "server-only";
import { createHash } from "node:crypto";
import { adminServices } from "./firebase";
import { AccessError } from "./auth";

export async function enforceRateLimit(uid: string, action: string, options: {limit: number; windowMs: number}): Promise<void> {
  if (!uid || !action || !Number.isInteger(options.limit) || options.limit < 1 || options.windowMs < 1000) throw new AccessError(400, "Invalid request limit.");
  const key = createHash("sha256").update(`${uid}\0${action}`).digest("hex");
  const { db } = adminServices();
  const reference = db.collection("requestLimits").doc(key);
  const now = Date.now();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const previous = snapshot.data();
    const currentWindow = previous && Number(previous.windowStartedAt) > now - options.windowMs;
    const count = currentWindow ? Number(previous.count || 0) : 0;
    if (count >= options.limit) throw new AccessError(429, "Too many requests. Please wait and try again.");
    transaction.set(reference, {windowStartedAt: currentWindow ? previous!.windowStartedAt : now, count: count + 1, expiresAt: new Date(now + options.windowMs * 2)});
  });
}
