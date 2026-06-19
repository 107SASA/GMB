export interface GeoGridPoint {
  lat: number;
  lng: number;
  row: number;
  col: number;
}

export const GRID_SPACING_KM = 1.5;
export const GRID_SIZE = 3;
// Span = spacing × (size − 1) = 1.5 × 2 = 3 km per axis → 3 × 3 = 9 sq km
export const GRID_AREA_SQ_KM = (GRID_SPACING_KM * (GRID_SIZE - 1)) ** 2;

/**
 * Returns GRID_SIZE² points (9) arranged in a square grid around the given
 * centre. Degree offsets are computed so the grid is roughly square on the
 * ground at any latitude (longitude degrees shrink toward the poles).
 */
export function generateGeoGrid(
  centerLat: number,
  centerLng: number,
  spacingKm = GRID_SPACING_KM,
): GeoGridPoint[] {
  const latDegPerKm = 1 / 111;
  const lngDegPerKm = 1 / (111 * Math.cos((centerLat * Math.PI) / 180));
  const half = Math.floor(GRID_SIZE / 2); // 1 for a 3×3 grid

  const points: GeoGridPoint[] = [];
  for (let row = -half; row <= half; row++) {
    for (let col = -half; col <= half; col++) {
      points.push({
        lat: parseFloat((centerLat + row * spacingKm * latDegPerKm).toFixed(6)),
        lng: parseFloat((centerLng + col * spacingKm * lngDegPerKm).toFixed(6)),
        row,
        col,
      });
    }
  }
  return points;
}
