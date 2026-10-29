import type { RefModCurve } from './types'
/** Display equivalent of the pinned MiniMaxH3Mod curve_value_at (MIT, Luisacaotica). */
export function refModCurveValue(c: RefModCurve, x: number): number {
  let y = x
  switch (c.shape) {
    case 'ease':
      y = x * x * (3 - 2 * x)
      break
    case 'sigmoid':
      y = 1 / (1 + Math.exp(-12 * (x - 0.5)))
      break
    case 'tanh':
      y = 0.5 * (Math.tanh(8 * (x - 0.5)) + 1)
      break
    case 'quadratic':
      y = x * x
      break
    case 'cubic':
      y = x * x * x
      break
    case 'exponential':
      y = 2 ** x - 1
      break
    case 'stair':
      y = Math.min(1, Math.floor(x * 4) / 3)
      break
    case 'elastic':
      y =
        x <= 0
          ? 0
          : x >= 1
            ? 1
            : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
      break
    case 'bump':
      y = 1 - Math.abs(2 * x - 1)
      break
    case 'dip':
      y = Math.abs(2 * x - 1)
      break
  }
  if (c.direction === 'constant' && c.shape === 'linear') return c.value
  if (c.direction === 'concept_at_start') y = 1 - y
  else if (c.direction === 'concept_at_middle') y = 1 - Math.abs(2 * y - 1)
  else if (c.direction === 'concept_at_ends') y = Math.abs(2 * y - 1)
  return Math.max(0, Math.min(1, c.value * y))
}
