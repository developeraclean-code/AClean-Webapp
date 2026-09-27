import { describe, expect, it } from "vitest";
import {
  fieldActionBelongsToUser, fieldQueueBackoffMs, fieldUserKey,
  getFieldStorageHealth, isRetryableUploadStatus, queuedPhotoActionId,
} from "../fieldOfflineQueue.js";

describe("field offline queue policy", () => {
  it("uses bounded exponential backoff", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(fieldQueueBackoffMs)).toEqual([
      0, 10_000, 30_000, 90_000, 300_000, 900_000, 1_800_000,
    ]);
  });

  it("retries network, timeout, rate-limit, and server errors only", () => {
    expect(isRetryableUploadStatus(undefined)).toBe(true);
    expect(isRetryableUploadStatus(408)).toBe(true);
    expect(isRetryableUploadStatus(429)).toBe(true);
    expect(isRetryableUploadStatus(503)).toBe(true);
    expect(isRetryableUploadStatus(400)).toBe(false);
    expect(isRetryableUploadStatus(403)).toBe(false);
  });

  it("deduplicates queued photos by job and content hash", () => {
    expect(queuedPhotoActionId("JOB-1", "abc", "tech-1")).toBe("photo:tech-1:JOB-1:abc");
  });

  it("isolates queue rows per signed-in field user", () => {
    expect(fieldUserKey({ id: " USER-1 " })).toBe("user-1");
    expect(fieldActionBelongsToUser({ userKey: "user-1" }, "user-1")).toBe(true);
    expect(fieldActionBelongsToUser({ userKey: "user-2" }, "user-1")).toBe(false);
    expect(fieldActionBelongsToUser({}, "user-1")).toBe(false);
  });

  it("blocks offline photo writes near the storage limit", async () => {
    const full = await getFieldStorageHealth(2 * 1024 * 1024, {
      storage: { estimate: async () => ({ quota: 100 * 1024 * 1024, usage: 94 * 1024 * 1024 }) },
    });
    expect(full.supported).toBe(true);
    expect(full.canStore).toBe(false);

    const healthy = await getFieldStorageHealth(2 * 1024 * 1024, {
      storage: { estimate: async () => ({ quota: 100 * 1024 * 1024, usage: 20 * 1024 * 1024 }) },
    });
    expect(healthy.canStore).toBe(true);
  });
});
