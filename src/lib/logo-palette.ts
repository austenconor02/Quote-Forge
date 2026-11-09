"use client";

export async function colorsFromLogo(source: string): Promise<string[]> {
  if (!source) return [];
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) return [];
  context.drawImage(image, 0, 0, 48, 48);
  const { data } = context.getImageData(0, 0, 48, 48);
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  for (let index = 0; index < data.length; index += 4) {
    const [r, g, b, a] = [data[index], data[index + 1], data[index + 2], data[index + 3]];
    if (a < 180 || Math.min(r, g, b) > 235) continue;
    const key = [r, g, b].map(value => Math.floor(value / 24)).join(",");
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count++;
    buckets.set(key, bucket);
  }
  const colors: { r: number; g: number; b: number }[] = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    const color = { r: Math.round(bucket.r / bucket.count), g: Math.round(bucket.g / bucket.count), b: Math.round(bucket.b / bucket.count) };
    if (colors.every(existing => Math.hypot(existing.r - color.r, existing.g - color.g, existing.b - color.b) > 65)) colors.push(color);
    if (colors.length === 6) break;
  }
  return colors.map(color => "#" + [color.r, color.g, color.b].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase());
}
