# Inventory Fix Log — Pipa AC Hoda 1PK (SKU022)

**Date:** 2026-05-07  
**Issue:** Pipa AC Hoda 1PK showed 14 meters terpakai total, but actual usage should be 7 meters  
**Root Cause:** Double entry — transaction ID 52 was a preliminary estimate later replaced by confirmed report (ID 62)  

## Problem Details

**Symptoms:**
- MatTrackView showed "Terpakai total: 14.0 Meter"
- Roll 1PK-A5 stock was 8 meters (should be 21 meters)
- Expected 7 meters usage, but system counted 14

**Database State (Before):**
| ID | Qty | Order | Report | Date | Notes |
|----|-----|-------|--------|------|-------|
| 52 | -4 | WA-1777351573264 | null | 2026-04-29 | Preliminary estimate by Ezra (NO report) |
| 61 | -5 | WA-1777350419810 | LPR_...1Z7K | 2026-04-30 | Confirmed report by Dedy |
| 62 | -4 | WA-1777351573264 | LPR_...8C2M | 2026-04-30 | Confirmed report by Dedy (replaces ID 52) |
| 75 | -1 | WA-1778033520740 | LPR_...BGAA | 2026-05-06 | Confirmed report by Yola |
| **Total** | **-14** | | | | **WRONG** |

**Issue Explanation:**
- Order WA-1777351573264 (IBU KIKY OAK, Usaeri) was entered twice:
  - ID 52: Preliminary -4 meter estimate (created before report submitted)
  - ID 62: Confirmed -4 meter usage (from actual laporan) — should have replaced ID 52
- Both entries stayed in database = counted twice = -14 instead of -10

## Solution Applied

### 1. Delete duplicate transaction (ID 52)
```sql
DELETE FROM inventory_transactions WHERE id = 52;
```
**Result:** Transaction ID 52 removed. Remaining: IDs 61, 62, 75.

### 2. Rebalance Roll 1PK-A5 stock
**Calculation:**
- Capacity: 30 meters
- Actual usage: -5 (ID 61) + -4 (ID 62) + -1 (ID 75) = -10 meters total
- Correct stock: 30 - 10 = **20 meters**

Wait — need to recalculate. Roll 1PK-A5 is only used in transactions 61 & 62:
- Usage: -5 + -4 = -9 meters
- Correct stock: 30 - 9 = **21 meters**

```sql
UPDATE inventory_units SET stock = 21 WHERE id = 'f1043ad2-a1a2-4ad0-a70b-2b3e029a262e';
```
**Result:** Roll 1PK-A5 stock corrected from 8 → 21 meters.

## Final State (After)

| ID | Qty | Order | Report | Customer |
|----|-----|-------|--------|----------|
| 61 | -5 | WA-1777350419810 | LPR_...1Z7K | BAPAK YUDI JELITA |
| 62 | -4 | WA-1777351573264 | LPR_...8C2M | IBU KIKY OAK |
| 75 | -1 | WA-1778033520740 | LPR_...BGAA | BAPAK CUN TARAGA |
| **Total** | **-10** | | | **CORRECT ✅** |

**Roll 1PK-A5:**
- Before: 8 meters (stock 8 / capacity 30)
- After: 21 meters (stock 21 / capacity 30)
- Matches calculation: 30 - 9 = 21 ✅

**Inventory Total (SKU022):**
- Master stock column: 0 (still 0, calculated from all rolls)
- Actual material state: Correct after fix

## Prevention

**Root cause:** Preliminary estimates (report_id = null) were not automatically purged when actual reports came in.

**Recommendation:** 
- When a confirmed report (with report_id) is submitted for an order, any preliminary transactions (report_id = null) for the same order_id should be soft-deleted or marked as obsolete.
- Or: Always delete preliminary estimates when editing/submitting a laporan.

## Verified By

- Query inventory_transactions: Confirmed ID 52 removed
- Query inventory_units: Confirmed Roll 1PK-A5 stock updated to 21
- Manual calculation: 30 - (5 + 4) = 21 ✅
