import { Platform, Share } from 'react-native';

/**
 * Hands plain text to the OS share sheet. On web there is no share sheet
 * for arbitrary text, so it downloads a .txt file instead.
 */
export async function shareText(text: string, filename: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ message: text, title: filename });
}
