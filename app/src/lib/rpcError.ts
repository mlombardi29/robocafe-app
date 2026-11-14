/** PostgREST says this when the migration has not been applied yet. */
export function turnedOff(error: { code?: string; message?: string } | null, name: string): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return error.code === "PGRST202" || message.includes(name) || /does not exist|schema cache|could not find the function/i.test(message);
}

export const NOT_TURNED_ON = "This is not turned on yet. Nothing was saved.";
