import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';
import type { LocalMedia } from '@/api/jobs';

/**
 * Getting a photo, from the camera or from what is already on the phone.
 *
 * Both paths exist on purpose. Somebody standing in front of a leaking tap wants the camera;
 * somebody who photographed it this morning wants their gallery. Offering only one of those
 * makes half the people work around the app.
 *
 * A refused permission is not an error to swallow: iOS will not ask twice, so the only useful
 * thing we can do is explain and offer to open Settings.
 */

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

type Source = 'camera' | 'library';

async function ensurePermission(source: Source): Promise<boolean> {
  const current =
    source === 'camera' ? await ImagePicker.getCameraPermissionsAsync() : await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return true;

  if (!current.canAskAgain) {
    Alert.alert(
      source === 'camera' ? 'Camera access is off' : 'Photo access is off',
      'Turn it back on in Settings, under this app.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ],
    );
    return false;
  }

  const asked =
    source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  return asked.granted;
}

/**
 * Quality is deliberately below full: a job photo has to show a tap, not print at A3, and a
 * professional on a patchy connection should not wait on eight megabytes to send an offer.
 */
const OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, exif: false };

export async function capturePhoto(source: Source): Promise<LocalMedia | null> {
  if (!(await ensurePermission(source))) return null;

  const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(OPTIONS) : await ImagePicker.launchImageLibraryAsync(OPTIONS);
  if (picked.canceled || !picked.assets[0]) return null;

  const asset = picked.assets[0];
  if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
    Alert.alert('That photo is too large', 'Try taking it again, or pick a smaller one.');
    return null;
  }

  return {
    uri: asset.uri,
    kind: 'PHOTO',
    mime: asset.mimeType ?? 'image/jpeg',
    // The picker does not always report a size; the server checks the real one anyway, so a
    // reasonable estimate here is honest rather than a guess dressed up as a measurement.
    sizeBytes: asset.fileSize ?? 500_000,
  };
}

/**
 * Asks where the photo should come from. One sheet, two obvious answers - rather than two
 * buttons that both say "add" and leave people guessing which is which.
 */
export function askForPhoto(onPicked: (file: LocalMedia) => void, onError?: (message: string) => void) {
  Alert.alert('Add a photo', undefined, [
    {
      text: 'Take a photo',
      onPress: () => {
        void capturePhoto('camera')
          .then((f) => f && onPicked(f))
          .catch(() => onError?.('Could not open the camera.'));
      },
    },
    {
      text: 'Choose from gallery',
      onPress: () => {
        void capturePhoto('library')
          .then((f) => f && onPicked(f))
          .catch(() => onError?.('Could not open your photos.'));
      },
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
