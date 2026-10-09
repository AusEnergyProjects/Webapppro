import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FieldButton } from '@/components/field-button';
import { downloadRentalEvidencePhoto } from '@/lib/api';
import { assertLocalDataOwner, subscribeLocalDataOwner, type LocalDataOwner } from '@/lib/database';
import { colours, spacing } from '@/lib/theme';

export type RentalPhotoPreviewTarget = { jobMediaId?: string; uri?: string; contentType?: string; title: string };

export function RentalPhotoPreview({ photo, owner, online, onClose }: {
  photo: RentalPhotoPreviewTarget; owner: LocalDataOwner; online: boolean; onClose: () => void;
}) {
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let cached: File | null = null;
    const clearCache = () => { if (cached?.exists) cached.delete(); };
    const unsubscribe = subscribeLocalDataOwner(() => { controller.abort(); clearCache(); onClose(); });
    void (async () => {
      assertLocalDataOwner(owner);
      if (photo.uri && new File(photo.uri).exists) return photo.uri;
      if (!online) throw new Error('Reconnect to preview this saved photo.');
      if (!photo.jobMediaId) throw new Error('This photo is no longer on the phone. Reopen its saved photo.');
      const result = await downloadRentalEvidencePhoto(photo.jobMediaId, owner.key, controller.signal);
      if (controller.signal.aborted) return;
      assertLocalDataOwner(owner);
      if (photo.contentType && result.contentType !== photo.contentType) throw new Error('The saved photo did not match this evidence. Reopen the assessment.');
      const extension = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]).get(result.contentType);
      if (!extension) throw new Error('This photo type cannot be previewed.');
      cached = new File(Paths.cache, `tlink-rental-preview-${randomUUID()}.${extension}`);
      cached.write(result.bytes);
      assertLocalDataOwner(owner);
      return cached.uri;
    })().then(resultUri => { if (!controller.signal.aborted && resultUri) { setUri(resultUri); setError(''); } })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The photo could not load.'); });
    return () => { controller.abort(); unsubscribe(); clearCache(); };
  }, [photo, owner, online, onClose, retry]);
  return <Modal visible animationType="fade" onRequestClose={onClose}>
    <SafeAreaView style={styles.viewer}>
      <View style={styles.header}><Text style={styles.title}>{photo.title}</Text><FieldButton variant="secondary" onPress={onClose}>Close preview</FieldButton></View>
      {error ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><FieldButton onPress={() => { setUri(''); setError(''); setRetry(value => value + 1); }}>Retry preview</FieldButton></View>
        : uri ? <Image source={{ uri }} alt={photo.title} accessibilityLabel={photo.title} resizeMode="contain" style={styles.image} onError={() => setError('This photo could not be displayed. Try previewing it again.')} />
          : <View style={styles.loading}><ActivityIndicator color={colours.green} /><Text style={styles.body}>Opening photo...</Text></View>}
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: colours.forest },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  title: { flex: 1, color: colours.ink, fontSize: 18, fontWeight: '600' },
  image: { flex: 1, width: '100%' }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  body: { color: colours.muted }, notice: { padding: spacing.md, gap: spacing.md }, error: { color: colours.red },
});
