import { money } from "./pay";

export type PayPdfLine = {
  day: string;
  when: string;
  minutes: number;
  amount: number;
};

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** A one-page text PDF. The words are stored as plain text so a reader can open it. */
export function payPdf(input: {
  person: string;
  periodStart: string;
  periodEnd: string;
  paidOn: string;
  lines: PayPdfLine[];
  total: number;
}): string {
  const rows = [
    `Pay for ${input.person}`,
    `Period ${input.periodStart} to ${input.periodEnd}`,
    `Paid on ${input.paidOn}`,
    "",
    ...input.lines.map((line) => `${line.day}  ${line.when}  ${line.minutes} min  ${money(line.amount)}`),
    "",
    `Total ${money(input.total)}`,
  ];
  const commands = ["BT", "/F1 12 Tf", "72 740 Td", "14 TL"];
  for (const row of rows) commands.push(`(${escapePdf(row)}) Tj`, "T*");
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
