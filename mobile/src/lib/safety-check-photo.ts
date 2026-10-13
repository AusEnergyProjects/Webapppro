import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ATTEMPTS = [[2560, 0.85], [2200, 0.8], [1920, 0.75], [1600, 0.7]] as const;

/** An email-sized photo derivative; its caller retains it before uploading.
 * Original camera/library files are never modified or deleted here. */
export async function prepareSafetyCheckPhoto(uri: string): Promise<File> {
  const original = new File(uri);
  if (!original.exists || original.size < 5 || original.size > 50 * 1024 * 1024) {
    throw new Error('Choose an appliance photo under 50 MB. The original remains on your phone.');
  }
  const dimensions = await Image.getSize(uri);
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error('The photo dimensions could not be read. Choose or take the photo again.');
  }
  for (const [edge, compress] of ATTEMPTS) {
    const image = ImageManipulator.manipulate(uri);
    let rendered: Awaited<ReturnType<typeof image.renderAsync>> | undefined;
    let candidate: File | undefined;
    let retained = false;
    try {
      if (Math.max(dimensions.width, dimensions.height) > edge) {
        image.resize(dimensions.width >= dimensions.height ? { width: edge, height: null } : { width: null, height: edge });
      }
      rendered = await image.renderAsync();
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
      candidate = new File(result.uri);
      if (candidate.exists && candidate.size >= 5 && candidate.size <= MAX_PHOTO_BYTES) {
        retained = true;
        return candidate;
      }
    } finally {
      if (!retained && candidate?.exists) candidate.delete();
      rendered?.release();
      image.release();
    }
  }
  throw new Error('This photo could not fit the email size limit at readable quality. Take a closer appliance or label photo.');
}
