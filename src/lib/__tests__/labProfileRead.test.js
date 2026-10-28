import { describe, expect, it, vi } from "vitest";
import { fetchUserAccounts } from "../../data/reads.js";

function client() {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn() };
  return { from: vi.fn(() => query), query };
}

describe("lab profile directory selection", () => {
  it.each(["Teknisi", "Helper"])("reads only the safe directory for %s", role => {
    const supabase = client();
    fetchUserAccounts(supabase, role);
    expect(supabase.from).toHaveBeenCalledWith("lab_team_directory");
    expect(supabase.query.select).toHaveBeenCalledWith("id,name,role,status,active,color,avatar,skills");
  });

  it.each(["Owner", "Admin", "Finance"])("keeps the account read for %s", role => {
    const supabase = client();
    fetchUserAccounts(supabase, role);
    expect(supabase.from).toHaveBeenCalledWith("user_profiles");
  });
});
