import { describe, expect, it } from "vitest";
import { fieldQueueBackoffMs, isRetryableUploadStatus, queuedPhotoActionId } from "../fieldOfflineQueue.js";

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
    expect(queuedPhotoActionId("JOB-1", "abc")).toBe("photo:JOB-1:abc");
  });
});
