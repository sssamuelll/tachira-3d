export const A = 6378137.0                    // semieje mayor, m
export const F = 1 / 298.257223563            // achatamiento
export const B = A * (1 - F)                  // semieje menor, m
export const E2 = F * (2 - F)                 // primera excentricidad²
export const EP2 = (A * A - B * B) / (B * B)  // segunda excentricidad²
