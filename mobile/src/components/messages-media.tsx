import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { AppState, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiDownloadMessageMedia } from '@/lib/api';
import { type MessageAttachment, nativeMessageUploadPart, uploadMessageAttachment } from '@/lib/messages-client';
import { colours } from '@/lib/theme';
import { FieldButton } from '@/components/field-button';
import { MessageIconButton, MessageLoading, MessageNotice, messageStyles } from '@/components/messages-ui';

function deleteCacheFile(file: File | null) {
  if (file?.exists) file.delete();
}

function VoicePlayer({ uri, disabled }: { uri: string; disabled: boolean }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState('');
  useEffect(() => { if (disabled) player.pause(); }, [disabled, player]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') player.pause(); });
    return () => listener.remove();
  }, [player]);
  const toggle = async () => {
    try {
      setError('');
      if (status.playing) player.pause();
      else {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false });
        if (status.didJustFinish || status.currentTime >= status.duration) await player.seekTo(0);
        player.play();
      }
    } catch { setError('This voice note could not play. Try opening it again.'); }
  };
  return <View><View style={messageStyles.row}><MessageIconButton icon={status.playing ? 'pause' : 'play'} label={status.playing ? 'Pause voice note' : 'Play voice note'} disabled={disabled} onPress={() => void toggle()} /><Text style={messageStyles.body}>Voice note · {Math.floor(status.currentTime)}s / {Math.ceil(status.duration || 0)}s</Text></View>{error ? <MessageNotice error>{error}</MessageNotice> : null}</View>;
}

export function MessageMedia({ attachment, callsBusy, onVisibilityChange }: { attachment: MessageAttachment; callsBusy: boolean; onVisibilityChange?: (id: string, visible: boolean) => void }) {
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const showPhoto = (visible: boolean) => { onVisibilityChange?.(attachment.id, visible); setExpanded(visible); };
  useEffect(() => () => { onVisibilityChange?.(attachment.id, false); }, [attachment.id, onVisibilityChange]);
  useEffect(() => {
    const controller = new AbortController();
    let cached: File | null = null;
    void apiDownloadMessageMedia(attachment.id, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.contentType !== attachment.contentType) throw new Error('The attachment did not match this message.');
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm' }[result.contentType];
      if (!extension) throw new Error('This attachment type cannot be opened.');
      cached = new File(Paths.cache, `tlink-message-${randomUUID()}.${extension}`);
      cached.write(result.bytes); setUri(cached.uri);
    }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The attachment could not load.'); });
    return () => { controller.abort(); deleteCacheFile(cached); };
  }, [attachment.id, attachment.contentType, retry]);
  if (error) return <View><MessageNotice error>{error}</MessageNotice><FieldButton variant="quiet" onPress={() => { setError(''); setUri(''); setRetry(value => value + 1); }}>Retry attachment</FieldButton></View>;
  if (!uri) return <MessageLoading />;
  if (attachment.kind === 'audio') return <VoicePlayer uri={uri} disabled={callsBusy} />;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Open photo" onPress={() => showPhoto(true)}><Image source={{ uri }} alt="Team message photo" accessibilityLabel="Team message photo" style={styles.photo} resizeMode="cover" /></Pressable>
    <Modal visible={expanded} animationType="fade" onRequestClose={() => showPhoto(false)}><SafeAreaView style={styles.viewer}><View style={messageStyles.row}><Text style={[messageStyles.title, messageStyles.grow]}>Photo</Text><MessageIconButton icon="close" label="Close photo" onPress={() => showPhoto(false)} /></View><Image source={{ uri }} alt="Expanded team photo" accessibilityLabel="Expanded team photo" style={{ flex: 1 }} resizeMode="contain" /></SafeAreaView></Modal>
  </>;
}

export function MessageMediaComposer({ threadId, disabled, callsBusy, count, onAdd, onBusyChange, onError }: {
  threadId: string; disabled: boolean; callsBusy: boolean; count: number; onAdd: (attachment: MessageAttachment) => void; onBusyChange: (busy: boolean) => void; onError: (error: string) => void;
}) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000 });
  const state = useAudioRecorderState(recorder, 250);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const recording = useRef(false);
  const [busy, setBusy] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const localAudio = useRef<File | null>(null);
  const callsBusyRef = useRef(callsBusy);
  useEffect(() => { callsBusyRef.current = callsBusy; }, [callsBusy]);
  const report = (message: string) => { if (alive.current) onError(message); };
  const markBusy = (value: boolean) => { busyRef.current = value; if (alive.current) { setBusy(value); onBusyChange(value || recording.current); } };

  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active' && recording.current) {
        recording.current = false;
        void recorder.stop().then(() => { if (alive.current) { setHasRecording(Boolean(recorder.uri)); onBusyChange(false); } }).catch(() => { if (alive.current) onError('Recording stopped. Please try again.'); });
      }
    });
    return () => {
      alive.current = false; abort.current?.abort(); listener.remove();
      const clean = () => { deleteCacheFile(localAudio.current); if (recorder.uri) deleteCacheFile(new File(recorder.uri)); };
      if (recording.current) { recording.current = false; void recorder.stop().then(clean).catch(clean); } else clean();
    };
    // A composer belongs to exactly one mounted conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  async function upload(file: File, type: string, name: string) {
    if (file.size > (type.startsWith('image/') ? 3 : 5) * 1024 * 1024) throw new Error('That file is too large. Choose a smaller photo or a shorter voice note.');
    if (!alive.current) return;
    abort.current = new AbortController();
    const result = await uploadMessageAttachment(threadId, nativeMessageUploadPart(file, name, type), name, abort.current.signal);
    if (alive.current) onAdd(result.attachment);
  }

  async function photo(camera: boolean) {
    if (busyRef.current || disabled || count >= 4 || recording.current || hasRecording) return;
    markBusy(true); onError(''); let prepared: File | null = null;
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Camera access is off. Allow TLink camera access in your device settings, or choose a saved photo.');
      }
      if (!alive.current || AppState.currentState !== 'active') return;
      const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsMultipleSelection: false });
      if (result.canceled || !alive.current) return;
      const asset = result.assets[0];
      const context = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > 1800) context.resize(asset.width > asset.height ? { width: 1800 } : { height: 1800 });
      const rendered = await context.renderAsync();
      const image = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
      prepared = new File(image.uri);
      if (alive.current) await upload(prepared, 'image/jpeg', 'photo.jpg');
    } catch (caught) { report(caught instanceof Error ? caught.message : 'The photo could not be attached. Try again.'); }
    finally { deleteCacheFile(prepared); markBusy(false); }
  }
  async function startRecording() {
    if (busyRef.current || disabled || callsBusy || count >= 4 || hasRecording) return;
    markBusy(true); onError('');
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone access is off. Allow TLink microphone access in your device settings to record a voice note.');
      if (!alive.current || callsBusyRef.current || AppState.currentState !== 'active') return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false });
      await recorder.prepareToRecordAsync();
      if (!alive.current || callsBusyRef.current || AppState.currentState !== 'active') { await recorder.stop(); return; }
      recorder.record({ forDuration: 120 }); recording.current = true; onBusyChange(true);
    } catch (caught) { report(caught instanceof Error ? caught.message : 'Recording could not start. Try again.'); }
    finally { markBusy(false); }
  }
  async function finishRecording() {
    if (busyRef.current) return;
    markBusy(true);
    try {
      if (recording.current) { await recorder.stop(); recording.current = false; }
      if (!alive.current || !recorder.uri) return;
      localAudio.current = new File(recorder.uri); setHasRecording(true);
      await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false });
      await upload(localAudio.current, 'audio/mp4', 'voice-note.m4a');
      deleteCacheFile(localAudio.current); localAudio.current = null;
      if (alive.current) setHasRecording(false);
    } catch (caught) { report(caught instanceof Error ? caught.message : 'The voice note is still here. Tap Attach voice note to try again.'); }
    finally { markBusy(false); }
  }
  async function discardRecording() {
    if (busyRef.current) return;
    markBusy(true);
    try {
      if (recording.current) { await recorder.stop(); recording.current = false; }
      if (recorder.uri) deleteCacheFile(new File(recorder.uri));
      localAudio.current = null;
      if (alive.current) setHasRecording(false);
      if (!callsBusyRef.current) await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false });
    } catch (caught) { report(caught instanceof Error ? caught.message : 'The recording could not be stopped. Try again.'); }
    finally { markBusy(false); }
  }
  useEffect(() => {
    if (recording.current && !state.isRecording && state.durationMillis >= 119000) {
      recording.current = false; setHasRecording(true); onBusyChange(false);
    }
  }, [state.isRecording, state.durationMillis, onBusyChange]);
  useEffect(() => {
    if (callsBusy && recording.current) {
      recording.current = false;
      void recorder.stop().then(() => { if (alive.current) { setHasRecording(true); onBusyChange(false); } }).catch(() => undefined);
    }
  }, [callsBusy, recorder, onBusyChange]);
  return <View style={styles.tools}>
    {state.isRecording || hasRecording ? <>
      <Text style={[messageStyles.muted, messageStyles.grow]}>{state.isRecording ? `Recording · ${Math.floor(state.durationMillis / 1000)}s / 120s` : 'Voice note ready'}</Text>
      <MessageIconButton icon="delete-outline" label="Discard voice note" disabled={busy} onPress={() => void discardRecording()} />
      <MessageIconButton icon={state.isRecording ? 'stop-circle-outline' : 'paperclip'} label={state.isRecording ? 'Stop and attach voice note' : 'Attach voice note'} disabled={busy || callsBusy} onPress={() => void finishRecording()} />
    </> : <>
      <MessageIconButton icon="camera-outline" label="Take photo" disabled={disabled || busy || count >= 4} onPress={() => void photo(true)} />
      <MessageIconButton icon="image-outline" label="Choose photo" disabled={disabled || busy || count >= 4} onPress={() => void photo(false)} />
      <MessageIconButton icon="microphone-outline" label="Record voice note" disabled={disabled || busy || callsBusy || count >= 4} onPress={() => void startRecording()} />
      <Text style={[messageStyles.muted, messageStyles.grow]}>{busy ? 'Attaching...' : count ? `${count}/4 attachments` : 'Photos & voice notes'}</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({ photo: { width: '100%', height: 180, borderRadius: 12, backgroundColor: colours.surface }, viewer: { flex: 1, backgroundColor: colours.cream, padding: 16 }, tools: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 4 } });
