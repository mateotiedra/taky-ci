/**
 * Replaces ${placeholder} tokens in a template string with values from vars.
 * Unmatched placeholders are left as-is.
 */
export function interpolate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(
    /\$\{(\w+)\}/g,
    (match, key) => vars[key] ?? match
  );
}
