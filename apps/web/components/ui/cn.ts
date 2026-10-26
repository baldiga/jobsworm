import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes so a caller's override actually wins.
 *
 * Without twMerge, `cn("px-4", "px-6")` emits both and the winner depends on
 * stylesheet order rather than call order, which makes every primitive's
 * `className` prop unreliable.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
