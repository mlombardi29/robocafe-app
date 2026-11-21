/** Task titles for a person who is leaving. Never include a code value. */

const KIND_LABEL: Record<string, string> = {
  key_card: "key card",
  paper_pass: "paper pass",
  machine_key: "machine key",
};

export function offboardingTitles(input: {
  personName: string;
  assets: { siteName: string; kind: string }[];
  codeLabels: { siteName: string; label: string }[];
}): string[] {
  const titles: string[] = [];
  for (const asset of input.assets) {
    const kind = KIND_LABEL[asset.kind] ?? "item";
    titles.push(`Return the ${kind} for ${asset.siteName}.`);
  }
  for (const code of input.codeLabels) {
    titles.push(`Change the ${code.label} at ${code.siteName}.`);
  }
  if (titles.length === 0) {
    titles.push(`Confirm ${input.personName} has nothing to return.`);
  }
  return titles;
}
