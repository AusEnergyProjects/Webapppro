import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colours, spacing } from '@/lib/theme';
import { KeyboardAwareScrollView } from '@/components/keyboard-aware-scroll-view';

export function Screen({ children, scroll = true, style, scrollKey }: { children: ReactNode; scroll?: boolean; style?: ViewStyle; scrollKey?: string }) {
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [scrollKey]);
  const content = <View style={[styles.content, scroll ? styles.scrollContent : styles.fixedContent, style]}>{children}</View>;
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {scroll ? <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >{content}</KeyboardAwareScrollView> : content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.cream },
  scroll: { flexGrow: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  scrollContent: { flexGrow: 1 },
  fixedContent: { flex: 1 },
});
