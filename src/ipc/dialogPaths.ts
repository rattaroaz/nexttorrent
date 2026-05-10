/** Normalize dialog plugin return types across platforms (string vs array). */
export function normalizeDialogFilePath(
  result: string | string[] | null,
): string | null {
  if (result == null) {
    return null;
  }
  if (Array.isArray(result)) {
    return result[0] ?? null;
  }
  return result;
}
