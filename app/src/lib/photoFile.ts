import { fitWithin } from "./opsRules";

/** Shrink a phone photo so the long edge is at most 1600 pixels. */
export async function compressPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const box = fitWithin(bitmap.width, bitmap.height, 1600);
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Could not compress the photo.");
  }
  context.drawImage(bitmap, 0, 0, box.width, box.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((next) => resolve(next), "image/jpeg", 0.8));
  if (!blob) throw new Error("Could not compress the photo.");
  return blob;
}
