import postcodeCentroids from "@/data/postcode-centroids.json";

type Coordinate = readonly [latitude: number, longitude: number];
const centroids = postcodeCentroids as unknown as Record<string, Coordinate>;

export function postcodeCoordinate(postcode: string): Coordinate | null {
  const coordinate = centroids[String(postcode || "").padStart(4, "0")];
  return coordinate && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]) ? coordinate : null;
}

export function postcodeDistanceKm(originPostcode: string, destinationPostcode: string): number | null {
  const origin = postcodeCoordinate(originPostcode);
  const destination = postcodeCoordinate(destinationPostcode);
  if (!origin || !destination) return null;

  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(destination[0] - origin[0]);
  const longitudeDelta = radians(destination[1] - origin[1]);
  const originLatitude = radians(origin[0]);
  const destinationLatitude = radians(destination[0]);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
