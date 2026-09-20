import { describe, expect, it } from "vitest";
import { classifyMonitorEvent } from "../../../api/_handlers/monitor.js";

describe("classifyMonitorEvent", () => {
  it("memisahkan antrean tindakan dari error sistem", () => {
    expect(classifyMonitorEvent({ action: "MAINTENANCE_UNIT_SELECT_NEEDED", status: "WARNING" }))
      .toBe("action_required");
    expect(classifyMonitorEvent({ action: "SCAN_BUKTI_FUZZY", status: "WARNING" }))
      .toBe("action_required");
  });

  it("memisahkan audit berisiko dari error sistem", () => {
    expect(classifyMonitorEvent({ action: "ORDER_DELETED", status: "WARNING" })).toBe("audit");
  });

  it("tetap menandai error nyata sebagai system_error", () => {
    expect(classifyMonitorEvent({ action: "INVOICE_INSERT_FAILED", status: "ERROR" })).toBe("system_error");
    expect(classifyMonitorEvent({ action: "UNKNOWN", severity: "critical" })).toBe("system_error");
  });
});
