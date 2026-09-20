export const isTeamSplitOrder = (order) => Boolean(
  order?.is_team_split && String(order?.job_group_id || "").trim()
);

export const teamSplitGroupId = (order) => (
  isTeamSplitOrder(order) ? String(order.job_group_id).trim() : null
);

export function getTeamSplitProgress(order, orders = [], reports = []) {
  const groupId = teamSplitGroupId(order);
  if (!groupId) return null;
  const members = (orders || []).filter((item) => (
    isTeamSplitOrder(item) && teamSplitGroupId(item) === groupId
  ));
  const memberIds = new Set(members.map((item) => item.id));
  const groupReports = (reports || []).filter((report) => memberIds.has(report.job_id));
  const submittedIds = new Set(groupReports.map((report) => report.job_id));
  const verifiedIds = new Set(groupReports.filter((report) => report.status === "VERIFIED").map((report) => report.job_id));
  return {
    groupId,
    teamCount: members.length,
    submittedCount: submittedIds.size,
    verifiedCount: verifiedIds.size,
    allSubmitted: members.length > 0 && submittedIds.size === members.length,
    allVerified: members.length > 0 && verifiedIds.size === members.length,
  };
}

export function getTeamFinalizationOutcome(data) {
  const group = data?.group;
  if (!group?.id) return null;
  const teamCount = Number(group.team_count || 0);
  const verifiedCount = Number(group.verified_count || 0);
  return {
    groupId: group.id,
    teamCount,
    verifiedCount,
    ready: group.ready === true,
    waitingCount: Math.max(0, teamCount - verifiedCount),
    invoice: data?.invoice || null,
  };
}

