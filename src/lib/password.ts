export const MIN_PASSWORD = 10;

/** Why a new password cannot be used, or null when it can. */
export function passwordProblem(password: string, again: string): string | null {
  if (password.trim().length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password !== again) return "The two passwords do not match.";
  return null;
}
