const OPERATIONAL_FIELDS = [
  "customer", "customer_id", "phone", "address", "area", "notes", "service", "type", "units",
  "teknisi", "helper", "teknisi2", "helper2", "teknisi3", "helper3", "assigned_members",
  "date", "time", "time_end", "maintenance_client_id", "maintenance_unit_ids",
];

const normalized = value => {
  if (value == null) return "";
  if (Array.isArray(value)) return JSON.stringify(value.map(item => normalized(item)));
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim().toLowerCase();
};

export function buildFieldOrderSnapshot(order = {}) {
  return Object.fromEntries(OPERATIONAL_FIELDS.map(key => [key, order[key] ?? null]));
}

export function findFieldOrderConflicts(snapshot = {}, live = {}) {
  return OPERATIONAL_FIELDS.filter(key => normalized(snapshot[key]) !== normalized(live[key]));
}

export function hasFieldOrderConflict(snapshot, live) {
  return findFieldOrderConflicts(snapshot, live).length > 0;
}

export { OPERATIONAL_FIELDS as FIELD_CONFLICT_FIELDS };
