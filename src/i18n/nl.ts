import { part1 } from './nl/part1.ts'
import { part2 } from './nl/part2.ts'
import { part3 } from './nl/part3.ts'

/** Dutch (Belgium) for every English text of the app; the key is the English text. */
export const nl: Record<string, string> = { ...part1, ...part2, ...part3 }
