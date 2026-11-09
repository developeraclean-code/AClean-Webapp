const PERSON_FIELDS = ["teknisi", "teknisi2", "teknisi3", "helper", "helper2", "helper3"];

export function projectCrewMembers(order, rosterMembers = []) {
  const names = [
    ...(Array.isArray(order?.assigned_members) ? order.assigned_members : []),
    ...PERSON_FIELDS.map(field => order?.[field]),
    ...rosterMembers.map(member => typeof member === "string" ? member : member?.name),
  ];
  const seen = new Set();
  return names.map(value => String(value || "").trim()).filter(name => {
    const key = name.toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function projectReportCrew(order, submitterName) {
  const teknisiName = String(order?.teknisi || submitterName || "").trim() || null;
  return {
    teknisiName,
    helperNames: projectCrewMembers(order).filter(name => name.toLocaleLowerCase() !== teknisiName?.toLocaleLowerCase()),
  };
}
