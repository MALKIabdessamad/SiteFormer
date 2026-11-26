/** Hex ↔ OKLCH, for the theme editor (the starter keeps its colors in oklch). */

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

export const HEX = /^#[0-9a-f]{6}$/i

/** "#3b82f6" → "oklch(0.623 0.188 259.8)". */
export function hexToOklch(hex: string): string {
  if (!HEX.test(hex)) throw new Error('Not a #rrggbb color')
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(A, B)
  const H = C < 0.0005 ? 0 : (Math.atan2(B, A) * 180) / Math.PI
  return `oklch(${round(L, 3)} ${round(C, 3)} ${round((H + 360) % 360, 1)})`
}

/** "oklch(0.623 0.188 259.8)" (or "oklch(62.3% …)") → "#3b82f6"; null when it isn't oklch. */
export function oklchToHex(value: string): string | null {
  const match =
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)$/i.exec(
      value.trim(),
    )
  if (!match) return null
  const L = Number(match[1]) / (match[2] ? 100 : 1)
  const C = Number(match[3])
  const h = (Number(match[4]) * Math.PI) / 180
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(c))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}
