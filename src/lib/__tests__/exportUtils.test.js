import { describe, it, expect } from "vitest";
import { buildCsv, escapeHtml, htmlTable, rp } from "../exportUtils.js";

describe("buildCsv", () => {
  it("prepends UTF-8 BOM and quotes every cell", () => {
    const csv = buildCsv(["A", "B"], [["1", "2"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv).toContain(`"A","B"`);
    expect(csv).toContain(`"1","2"`);
  });

  it("escapes embedded quotes by doubling them", () => {
    const csv = buildCsv(["X"], [[` dia bilang "halo" `]]);
    expect(csv).toContain(`" dia bilang ""halo"" "`);
  });

  it("keeps commas inside a field from breaking columns", () => {
    const csv = buildCsv(["Ket"], [["Pipa, kabel, freon"]]);
    const lastLine = csv.split("\r\n").pop();
    expect(lastLine).toBe(`"Pipa, kabel, freon"`); // satu sel, bukan tiga
  });

  it("renders null/undefined as empty string", () => {
    const csv = buildCsv(["A", "B", "C"], [[null, undefined, 0]]);
    expect(csv.split("\r\n").pop()).toBe(`"","","0"`);
  });

  it("separates rows with CRLF", () => {
    const csv = buildCsv(["H"], [["r1"], ["r2"]]);
    expect(csv.split("\r\n")).toHaveLength(3); // header + 2 baris
  });
});

describe("escapeHtml", () => {
  it("neutralizes HTML-significant characters", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("htmlTable", () => {
  it("applies column classes and renders a footer row", () => {
    const t = htmlTable(["Nama", "Total"], [["Budi", "Rp 10"]], {
      colClass: ["", "r"],
      footer: ["TOTAL", "Rp 10"],
    });
    expect(t).toContain(`<th class="r">Total</th>`);
    expect(t).toContain(`<td class="r">Rp 10</td>`);
    expect(t).toContain(`<tfoot>`);
    expect(t).toContain(`class="total"`);
  });

  it("passes cell HTML through unescaped so spans/classes render", () => {
    const t = htmlTable(["X"], [[`<span class="neg">−Rp 5</span>`]]);
    expect(t).toContain(`<span class="neg">−Rp 5</span>`);
  });
});

describe("rp", () => {
  it("formats numbers as Indonesian rupiah and treats blanks as 0", () => {
    expect(rp(1500000)).toBe("Rp 1.500.000");
    expect(rp(null)).toBe("Rp 0");
  });
});
