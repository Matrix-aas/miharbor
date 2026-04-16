// `cn` — the shadcn standard class merger. Combines `clsx` (conditional
// truthy/falsy rules) with `tailwind-merge` (de-duplicates Tailwind classes
// so later overrides win, e.g. `px-4 px-6` -> `px-6`).

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
