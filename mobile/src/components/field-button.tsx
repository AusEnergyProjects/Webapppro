import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colours, radius, spacing } from '@/lib/theme';

export function FieldButton({
  children,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles[variant], pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' ? colours.white : colours.forest} /> : (
        <Text style={[styles.label, variant === 'primary' && styles.primaryLabel, variant === 'danger' && styles.dangerLabel]}>{children}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colours.line,
  },
  primary: { backgroundColor: colours.green, borderColor: colours.green },
  secondary: { backgroundColor: colours.white, borderColor: colours.green },
  danger: { backgroundColor: colours.redSoft, borderColor: '#efb7b7' },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  label: { color: colours.forest, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  primaryLabel: { color: colours.white },
  dangerLabel: { color: colours.red },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});
