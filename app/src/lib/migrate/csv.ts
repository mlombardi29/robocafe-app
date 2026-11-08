/** Minimal CSV reader. Same quoting rules as the catalogue preview parser. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === "\"" && source[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") quoted = false;
      else cell += char;
      continue;
    }
    if (char === "\"") {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((part) => part.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((part) => part.trim() !== "")) rows.push(row);
  }
  return rows;
}

export function csvLine(cells: string[]): string {
  return cells
    .map((cell) => {
      if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, "\"\"")}"`;
      return cell;
    })
    .join(",");
}
