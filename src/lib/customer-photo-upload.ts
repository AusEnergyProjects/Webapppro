export const MAX_PREPARED_CUSTOMER_PHOTO_BYTES = 640 * 1024;

function jpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("PHOTO_CONVERSION_FAILED")),
    "image/jpeg",
    quality,
  ));
}

export async function prepareCustomerPhotoUpload(file: File, fallbackName = "customer-photo") {
  if (!file.type.startsWith("image/")) throw new Error("PHOTO_CONVERSION_FAILED");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("PHOTO_CONVERSION_FAILED"));
      element.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PHOTO_CONVERSION_FAILED");
    let maximumDimension = 1920;
    let quality = 0.82;
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const scale = Math.min(1, maximumDimension / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await jpegBlob(canvas, quality);
      if (blob.size <= MAX_PREPARED_CUSTOMER_PHOTO_BYTES) break;
      if (quality > 0.58) quality = Math.max(0.58, quality - 0.08);
      else {
        maximumDimension = Math.max(960, Math.round(maximumDimension * 0.8));
        quality = 0.74;
      }
    }
    if (!blob || blob.size > MAX_PREPARED_CUSTOMER_PHOTO_BYTES) throw new Error("PHOTO_TOO_LARGE");
    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || fallbackName;
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
