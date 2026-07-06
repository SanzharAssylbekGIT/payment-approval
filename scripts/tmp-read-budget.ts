// Разовый дамп структуры бюджетного Excel (лист/строки/числа).
import ExcelJS from "exceljs";

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(process.argv[2]);
  for (const ws of wb.worksheets) {
    console.log(`\n=== ЛИСТ: "${ws.name}" (${ws.rowCount} строк × ${ws.columnCount} колонок) ===`);
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 60) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 12) return;
        let v: unknown = cell.value;
        if (v && typeof v === "object" && "result" in (v as object)) v = (v as { result: unknown }).result;
        if (v && typeof v === "object" && "richText" in (v as object)) v = (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        if (v === null || v === undefined) v = "";
        cells.push(String(v).slice(0, 40));
      });
      console.log(`${String(rowNumber).padStart(3)} | ${cells.join(" | ")}`);
    });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
