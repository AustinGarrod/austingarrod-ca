import type { Coordinates } from "./distance";

export const EARTH_RADIUS_METERS = 6_371_008.8;

export interface TriangulationInput {
  id: string;
  center: Coordinates;
  radiusMeters: number;
}

export interface TriangulationResult {
  center: Coordinates;
  inputCount: number;
  rmsErrorMeters: number;
}

interface Candidate extends Coordinates {
  error: number;
}

const TO_RADIANS = Math.PI / 180;
const TO_DEGREES = 180 / Math.PI;

function radians(value: number): number {
  return value * TO_RADIANS;
}

function degrees(value: number): number {
  return value * TO_DEGREES;
}

export function normalizeLongitude(longitude: number): number {
  return ((longitude + 540) % 360) - 180;
}

export function greatCircleDistanceMeters(from: Coordinates, to: Coordinates): number {
  const fromLatitude = radians(from.lat);
  const toLatitude = radians(to.lat);
  const latitudeDelta = toLatitude - fromLatitude;
  const longitudeDelta = radians(normalizeLongitude(to.lng - from.lng));
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function destinationPoint(origin: Coordinates, bearingRadians: number, angularDistance: number): Coordinates {
  const latitude = radians(origin.lat);
  const longitude = radians(origin.lng);
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const sinDistance = Math.sin(angularDistance);
  const cosDistance = Math.cos(angularDistance);
  const nextLatitude = Math.asin(
    sinLatitude * cosDistance + cosLatitude * sinDistance * Math.cos(bearingRadians),
  );
  const nextLongitude = longitude + Math.atan2(
    Math.sin(bearingRadians) * sinDistance * cosLatitude,
    cosDistance - sinLatitude * Math.sin(nextLatitude),
  );
  return { lat: degrees(nextLatitude), lng: normalizeLongitude(degrees(nextLongitude)) };
}

function meanSquaredError(point: Coordinates, inputs: TriangulationInput[]): number {
  let total = 0;
  for (const input of inputs) {
    const residual = greatCircleDistanceMeters(point, input.center) - input.radiusMeters;
    total += residual * residual;
  }
  return total / inputs.length;
}

function sphericalMean(inputs: TriangulationInput[]): Coordinates | null {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const input of inputs) {
    const latitude = radians(input.center.lat);
    const longitude = radians(input.center.lng);
    const latitudeCosine = Math.cos(latitude);
    x += latitudeCosine * Math.cos(longitude);
    y += latitudeCosine * Math.sin(longitude);
    z += Math.sin(latitude);
  }
  const horizontal = Math.hypot(x, y);
  if (horizontal < 1e-12 && Math.abs(z) < 1e-12) {
    return null;
  }
  return { lat: degrees(Math.atan2(z, horizontal)), lng: normalizeLongitude(degrees(Math.atan2(y, x))) };
}

function fibonacciPoint(index: number, count: number): Coordinates {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (index + 0.5)) / count;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = index * goldenAngle;
  return {
    lat: degrees(Math.asin(y)),
    lng: normalizeLongitude(degrees(Math.atan2(Math.sin(angle) * radius, Math.cos(angle) * radius))),
  };
}

function optimize(start: Coordinates, inputs: TriangulationInput[]): Candidate {
  let current: Candidate = { ...start, error: meanSquaredError(start, inputs) };
  let step = Math.PI / 2;

  for (let iteration = 0; iteration < 180 && step > 1e-10; iteration += 1) {
    let best = current;
    for (let direction = 0; direction < 8; direction += 1) {
      const point = destinationPoint(current, direction * Math.PI / 4, step);
      const error = meanSquaredError(point, inputs);
      if (error < best.error) {
        best = { ...point, error };
      }
    }
    if (best === current) {
      step /= 2;
    } else {
      current = best;
    }
  }
  return current;
}

function hasThreeDistinctCenters(inputs: TriangulationInput[]): boolean {
  const distinct: Coordinates[] = [];
  for (const input of inputs) {
    if (!distinct.some((center) => greatCircleDistanceMeters(center, input.center) < 1)) {
      distinct.push(input.center);
    }
  }
  return distinct.length >= 3;
}

export function triangulateBestFit(inputs: TriangulationInput[]): TriangulationResult | null {
  const validInputs = inputs.filter(
    (input) => Number.isFinite(input.center.lat)
      && input.center.lat >= -90
      && input.center.lat <= 90
      && Number.isFinite(input.center.lng)
      && input.center.lng >= -180
      && input.center.lng <= 180
      && Number.isFinite(input.radiusMeters)
      && input.radiusMeters > 0,
  );
  if (validInputs.length < 3 || !hasThreeDistinctCenters(validInputs)) {
    return null;
  }

  const coarseCandidates: Candidate[] = [];
  const coarseCount = 96;
  for (let index = 0; index < coarseCount; index += 1) {
    const point = fibonacciPoint(index, coarseCount);
    coarseCandidates.push({ ...point, error: meanSquaredError(point, validInputs) });
  }
  coarseCandidates.sort((left, right) => left.error - right.error);

  const starts: Coordinates[] = [
    ...coarseCandidates.slice(0, 10),
    ...validInputs.map((input) => input.center),
  ];
  const mean = sphericalMean(validInputs);
  if (mean) {
    starts.push(mean, { lat: -mean.lat, lng: normalizeLongitude(mean.lng + 180) });
  }

  let best: Candidate | null = null;
  for (const start of starts) {
    const candidate = optimize(start, validInputs);
    if (!best || candidate.error < best.error) {
      best = candidate;
    }
  }
  if (!best || !Number.isFinite(best.error)) {
    return null;
  }

  return {
    center: { lat: best.lat, lng: normalizeLongitude(best.lng) },
    inputCount: validInputs.length,
    rmsErrorMeters: Math.sqrt(Math.max(0, best.error)),
  };
}
