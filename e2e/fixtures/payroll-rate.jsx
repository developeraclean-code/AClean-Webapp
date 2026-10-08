import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { GajiTab } from "../../src/views/TeknisiAdminView.jsx";

const initialEmployees = [
  { id: "new", name: "Karyawan Baru", role: "Teknisi", active: true, daily_rate: 0 },
  { id: "old", name: "Karyawan Lama", role: "Helper", active: true, daily_rate: 150000 },
];
const profileRates = { new: 0, old: 150000 };
const payrollRows = [{ id: "slip-old", user_id: "old", user_name: "Karyawan Lama", role: "Helper", period_start: "2026-10-05", period_end: "2026-10-10", days_worked: 2, daily_rate: 150000, is_paid: false }];
window.payrollTest = { profileRates, payrollRows, failProfile: false, failPayroll: false, calls: [] };

const db = {
  from(table) {
    const query = {
      mode: "read", value: null, id: null,
      select() { return this; },
      eq(key, value) { if (key === "id") this.id = value; return this; },
      is() { return this; }, gte() { return this; }, lte() { return this; }, in() { return this; }, order() { return this; },
      update(value) { this.mode = "update"; this.value = value; return this; },
      single() { return this; },
      then(resolve) {
        if (this.mode === "update") {
          window.payrollTest.calls.push({ table, id: this.id, value: this.value });
          if (table === "user_profiles") {
            if (window.payrollTest.failProfile) return resolve({ data: null, error: { code: "PGRST116", message: "No rows returned" } });
            profileRates[this.id] = this.value.daily_rate;
            return resolve({ data: { id: this.id, daily_rate: profileRates[this.id] }, error: null });
          }
          if (table === "weekly_payroll") {
            if (window.payrollTest.failPayroll) return resolve({ data: null, error: { code: "PGRST116", message: "No rows returned" } });
            const row = payrollRows.find(r => r.id === this.id);
            Object.assign(row, this.value);
            return resolve({ data: { id: row.id, daily_rate: row.daily_rate }, error: null });
          }
        }
        if (table === "weekly_payroll") return resolve({ data: payrollRows.map(row => ({ ...row })), error: null });
        if (table === "user_profiles") return resolve({ data: [], error: null });
        return resolve({ data: [], error: null });
      },
    };
    return query;
  },
};

function Fixture() {
  const [employees, setEmployees] = useState(initialEmployees);
  const [version, setVersion] = useState(0);
  const [role, setRole] = useState("Owner");
  return <>
    <button onClick={() => setVersion(v => v + 1)}>Buka ulang payroll</button>
    <button onClick={() => setRole("Finance")}>Masuk sebagai Finance</button>
    <GajiTab key={version} teknisiData={employees} setTeknisiData={setEmployees} ordersData={[]} invoicesData={[]}
      currentUser={{ name: "Dedy", role }} supabase={db} showNotif={message => window.payrollTest.calls.push({ notice: message })}
      showConfirm={async () => true} addAgentLog={() => {}} openWA={() => {}} TODAY="2026-10-08"
      bonusCategories={[]} setBonusCategories={() => {}} BONUS_LABELS={{}} BONUS_DEFAULTS={{}} />
  </>;
}

createRoot(document.getElementById("root")).render(<Fixture />);
