import type { Shell } from './types';

/**
 * Shell quoting for values that pass validation but are not plain tokens (a skill name with
 * spaces, for example). Values that cannot be quoted safely are refused before they get
 * here: control and invisible characters, and leading dashes, which a quoted argument would
 * still pass to the CLI as an option.
 */

const PLAIN = /^[A-Za-z0-9._/@:+=,-]+$/;

/** POSIX sh/bash/zsh: single quotes are literal; an embedded ' becomes '\''. */
export function quotePosix(value: string): string {
  if (PLAIN.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * PowerShell: single-quoted strings are literal; an embedded quote is doubled. PowerShell
 * also treats the typographic quotes U+2018 to U+201B as single quotes, so those are doubled too.
 */
export function quotePowerShell(value: string): string {
  if (PLAIN.test(value)) return value;
  return `'${value.replace(/['‘’‚‛]/g, (q) => q + q)}'`;
}

export function quote(value: string, shell: Shell): string {
  return shell === 'powershell' ? quotePowerShell(value) : quotePosix(value);
}

/** Joins an argument list into one command line. Every argument is quoted as needed. */
export function commandLine(args: readonly string[], shell: Shell): string {
  return args.map((arg) => quote(arg, shell)).join(' ');
}
