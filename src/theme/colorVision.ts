/**
 * Colour-vision-deficiency simulation (Machado, Oliveira & Fernandes 2009, severity 1.0) and the
 * CIELAB distance (ΔE76) between colors as seen with it. Used to check the colour-blind palette:
 * below about 10 two colors are hard to tell apart, above 20 they are clearly different.
 */
const MATRICES = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const

export type Vision = 'normal' | keyof typeof MATRICES

export const VISIONS: Vision[] = ['normal', 'protan', 'deutan', 'tritan']

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function toLab([r, g, b]: number[]): number[] {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = (0.4124 * r! + 0.3576 * g! + 0.1805 * b!) / 0.95047
  const y = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  const z = (0.0193 * r! + 0.1192 * g! + 0.9505 * b!) / 1.08883
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** A `#rrggbb` color in CIELAB, as someone with the given colour vision sees it. */
export function seenAs(hex: string, vision: Vision): number[] {
  const rgb = [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255))
  if (vision === 'normal') return toLab(rgb)
  const seen = MATRICES[vision].map((row) => Math.min(1, Math.max(0, row[0] * rgb[0]! + row[1] * rgb[1]! + row[2] * rgb[2]!)))
  return toLab(seen)
}

/** The smallest difference between two colors over normal vision and the three kinds of colour blindness. */
export function leastDifference(a: string, b: string): { difference: number; vision: Vision } {
  return VISIONS.map((vision) => {
    const [x, y] = [seenAs(a, vision), seenAs(b, vision)]
    return { difference: Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!), vision }
  }).reduce((least, next) => (next.difference < least.difference ? next : least))
}
