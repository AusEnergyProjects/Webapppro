import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { tradeTeamPresenceStatus, type TradeTeamPresenceStatus } from '../../../src/lib/trade-team-presence';
import { useBusinessApi } from '@/lib/use-business-api';
import { colours, radius, spacing } from '@/lib/theme';

export function TeamPresence() {
  const request = useBusinessApi();
  const [status,setStatus] = useState<TradeTeamPresenceStatus | null>(null), [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const active = useRef(true), generation = useRef(0), changing = useRef(false);
  const confirmedStatus = useRef<TradeTeamPresenceStatus | null>(null);
  const pending = useRef(new Set<AbortController>());
  const requestStatus = useCallback(async (init: RequestInit = {}) => {
    const controller = new AbortController();
    pending.current.add(controller);
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('PRESENCE_UNAVAILABLE'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      return await Promise.race([
        request<{ok:boolean;status:unknown}>('/api/trade-team-presence', { ...init, signal: controller.signal }),
        cancelled,
      ]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abort);
      pending.current.delete(controller);
    }
  }, [request]);
  const refresh = useCallback(async () => {
    if (changing.current) return;
    const epoch = ++generation.current;
    try {
      const result = await requestStatus();
      if (!result.ok) throw new Error('PRESENCE_UNAVAILABLE');
      const next = tradeTeamPresenceStatus(result.status);
      if (active.current && generation.current === epoch) {
        setStatus(next); setError('');
        if (confirmedStatus.current !== next) {
          confirmedStatus.current = next;
          DeviceEventEmitter.emit('tlink:team-presence-changed',{status:next});
        }
      }
    } catch { if (active.current && generation.current === epoch) setError('Call status could not load. Tap to try again.'); }
  },[requestStatus]);
  useEffect(() => {
    active.current = true;
    const pendingRequests = pending.current;
    const frame = requestAnimationFrame(() => void refresh());
    const app = AppState.addEventListener('change',value => { if (value === 'active') void refresh(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); },30000);
    return () => {
      active.current = false; generation.current++;
      pendingRequests.forEach(controller => controller.abort());
      cancelAnimationFrame(frame); app.remove(); clearInterval(timer);
    };
  },[refresh]);

  async function choose(next: TradeTeamPresenceStatus) {
    if (changing.current) return;
    if (next === status) { setOpen(false); return; }
    changing.current = true; const epoch = ++generation.current; setBusy(true); setError('');
    try {
      const result = await requestStatus({method:'PATCH',body:JSON.stringify({status:next})});
      if (!result.ok) throw new Error('PRESENCE_UNAVAILABLE');
      const saved = tradeTeamPresenceStatus(result.status);
      if (active.current && generation.current === epoch) {
        confirmedStatus.current = saved;
        setStatus(saved); setOpen(false);
        DeviceEventEmitter.emit('tlink:team-presence-changed',{status:saved});
      }
    } catch { if (active.current && generation.current === epoch) setError('Your status was not changed. Try again.'); }
    finally { changing.current = false; if (active.current) setBusy(false); }
  }

  const label = status ? status[0].toUpperCase()+status.slice(1) : error ? 'Retry status' : 'Status...';
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`My call status: ${label}`} style={styles.trigger} onPress={() => { setOpen(true); void refresh(); }}>
      <View style={[styles.dot,{backgroundColor:status==='online'?colours.green:status==='busy'?colours.amber:colours.muted}]} /><Text style={styles.triggerText}>{label} ▾</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.overlay}><View style={styles.card}>
        <Text style={styles.heading}>My call status</Text><Text style={styles.help}>Choose when teammates can call you. Messages still arrive in every status.</Text>
        {(['online','busy','offline'] as const).map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:status===value,disabled:busy}} disabled={busy} style={[styles.option,status===value&&styles.selected]} onPress={() => void choose(value)}>
          <View style={[styles.dot,{backgroundColor:value==='online'?colours.green:value==='busy'?colours.amber:colours.muted}]} /><View style={styles.copy}><Text style={styles.optionLabel}>{value[0].toUpperCase()+value.slice(1)}</Text><Text style={styles.help}>{value==='online'?'Available for calls':'Incoming calls off'}</Text></View>{status===value&&<Text style={styles.check}>✓</Text>}
        </Pressable>)}
        {busy&&<Text accessibilityLiveRegion="polite" style={styles.help}>Saving...</Text>}{error&&<Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" style={styles.close} onPress={() => setOpen(false)}><Text style={styles.triggerText}>Close</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}

const styles=StyleSheet.create({
  trigger:{flexDirection:'row',alignItems:'center',gap:6,minHeight:44,paddingHorizontal:10,borderRadius:10,borderWidth:1,borderColor:colours.line},
  triggerText:{color:colours.ink,fontSize:13,fontWeight:'700'},dot:{width:8,height:8,borderRadius:4},
  overlay:{flex:1,justifyContent:'center',padding:spacing.lg,backgroundColor:'#0009'},card:{backgroundColor:colours.surface,borderRadius:radius.lg,padding:spacing.lg,gap:spacing.md},
  heading:{color:colours.ink,fontSize:21,fontWeight:'700'},help:{color:colours.muted,fontSize:13,lineHeight:19},
  option:{flexDirection:'row',alignItems:'center',gap:spacing.sm,padding:spacing.md,borderRadius:radius.sm,borderWidth:1,borderColor:colours.line},selected:{borderColor:colours.green,backgroundColor:colours.mint},
  copy:{flex:1},optionLabel:{color:colours.ink,fontSize:16,fontWeight:'700'},check:{color:colours.green,fontSize:18},error:{color:colours.red,lineHeight:20},close:{minHeight:44,alignItems:'center',justifyContent:'center'},
});
