import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
} from 'react-native';

import { colours, radius, spacing } from '@/lib/theme';
import type {
  FieldWorkPackSignerRole,
  FieldWorkPackSignatureDraft,
  FieldWorkPackSignaturePoint,
  FieldWorkPackSignatureStroke,
} from '@/lib/types';

const PAD_HEIGHT = 220;
const MAX_SIGNATURE_STROKES = 32;
// Keep the exact vector packet comfortably below the mobile sync request cap.
const MAX_SIGNATURE_POINTS = 1_024;

function bounded(value: number) {
  return Math.max(0, Math.min(1, value));
}

function touchPoint(
  event: NativeSyntheticEvent<NativeTouchEvent>,
  width: number,
  height: number,
): FieldWorkPackSignaturePoint {
  const force = Number(event.nativeEvent.force);
  return {
    x: bounded(event.nativeEvent.locationX / Math.max(width, 1)),
    y: bounded(event.nativeEvent.locationY / Math.max(height, 1)),
    capturedAtMs: Date.now(),
    pressure: Number.isFinite(force) && force > 0 ? bounded(force) : null,
  };
}

function Segment({
  start,
  end,
  width,
  height,
}: {
  start: FieldWorkPackSignaturePoint;
  end: FieldWorkPackSignaturePoint;
  width: number;
  height: number;
}) {
  const x1 = start.x * width;
  const y1 = start.y * height;
  const x2 = end.x * width;
  const y2 = end.y * height;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return <View style={[
    styles.segment,
    {
      left: x1,
      top: y1,
      width: Math.max(length, 2),
      transform: [
        { translateX: length / 2 },
        { rotateZ: `${angle}rad` },
        { translateX: -length / 2 },
      ],
    },
  ]} />;
}

function Stroke({
  stroke,
  width,
  height,
}: {
  stroke: FieldWorkPackSignatureStroke;
  width: number;
  height: number;
}) {
  return <>{stroke.points.slice(1).map((point, index) => (
    <Segment
      key={`${stroke.strokeKey}:${index}`}
      start={stroke.points[index]}
      end={point}
      width={width}
      height={height}
    />
  ))}</>;
}

export function SignatureCapture({
  signerRole,
  declaration,
  value,
  disabled = false,
  displayOnly = false,
  onChange,
}: {
  signerRole: FieldWorkPackSignerRole;
  declaration: string;
  value: FieldWorkPackSignatureDraft;
  disabled?: boolean;
  displayOnly?: boolean;
  onChange: (value: FieldWorkPackSignatureDraft) => void;
}) {
  const [size, setSize] = useState({ width: 1, height: PAD_HEIGHT });
  const [liveValue, setLiveValue] = useState(value);
  const captureDisabled = disabled || displayOnly;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onChangeRef.current(liveValue);
  }, [liveValue]);

  const startStroke = useCallback((event: NativeSyntheticEvent<NativeTouchEvent>) => {
    if (captureDisabled) return;
    const firstPoint = touchPoint(event, size.width, size.height);
    setLiveValue((current) => {
      const currentPointCount = current.strokes.reduce(
        (count, stroke) => count + stroke.points.length,
        0,
      );
      if (
        current.strokes.length >= MAX_SIGNATURE_STROKES
        || currentPointCount >= MAX_SIGNATURE_POINTS
      ) return current;
      const nextStroke: FieldWorkPackSignatureStroke = {
        strokeKey: `stroke-${firstPoint.capturedAtMs}-${current.strokes.length + 1}`,
        points: [firstPoint],
      };
      return {
        ...current,
        strokes: [...current.strokes, nextStroke],
        capturedAt: current.capturedAt || new Date(firstPoint.capturedAtMs).toISOString(),
      };
    });
  }, [captureDisabled, size.height, size.width]);

  const moveStroke = useCallback((event: NativeSyntheticEvent<NativeTouchEvent>) => {
    if (captureDisabled) return;
    const point = touchPoint(event, size.width, size.height);
    setLiveValue((current) => {
      if (!current.strokes.length) return current;
      const pointCount = current.strokes.reduce(
        (count, stroke) => count + stroke.points.length,
        0,
      );
      if (pointCount >= MAX_SIGNATURE_POINTS) return current;
      const strokes = [...current.strokes];
      const activeStroke = strokes[strokes.length - 1];
      const previous = activeStroke.points[activeStroke.points.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0025) {
        return current;
      }
      strokes[strokes.length - 1] = {
        ...activeStroke,
        points: [...activeStroke.points, point],
      };
      return { ...current, strokes };
    });
  }, [captureDisabled, size.height, size.width]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !captureDisabled,
    onMoveShouldSetPanResponder: () => !captureDisabled,
    onPanResponderGrant: startStroke,
    onPanResponderMove: moveStroke,
    onPanResponderTerminationRequest: () => false,
  }), [captureDisabled, moveStroke, startStroke]);

  function layout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width: Math.max(width, 1), height: Math.max(height, 1) });
  }

  const pointCount = liveValue.strokes.reduce(
    (count, stroke) => count + stroke.points.length,
    0,
  );
  const signed = liveValue.strokes.length > 0 && pointCount >= 3;
  return <View style={styles.container}>
    <View style={styles.heading}>
      <MaterialCommunityIcons name="draw-pen" size={23} color={colours.green} />
      <View style={styles.flex}>
        <Text style={styles.title}>{signerRole.label} signature</Text>
        <Text style={styles.meta}>{displayOnly
          ? 'Captured signature shown exactly as drawn.'
          : 'Draw with a finger or stylus. A typed name does not count as a signature.'}</Text>
        <Text style={styles.meta}>Signing as {signerRole.capacity}</Text>
      </View>
    </View>
    <View style={styles.declaration} accessibilityRole="text">
      <Text style={styles.declarationLabel}>Declaration being signed</Text>
      <Text style={styles.declarationText}>{declaration}</Text>
    </View>
    <View style={styles.boundIdentity} accessibilityRole="summary">
      <Text style={styles.boundIdentityLabel}>Signer fixed from this job</Text>
      <Text style={styles.boundIdentityName}>{liveValue.signerName || 'Signer identity unavailable'}</Text>
      <Text style={styles.meta}>{signerRole.label} | {signerRole.capacity}</Text>
      {signerRole.identityRequirements.map((requirement) => (
        <Text key={requirement.fieldKey} style={styles.meta}>
          {requirement.label}: {liveValue.identity[requirement.fieldKey] || 'Not available'}
        </Text>
      ))}
    </View>
    <View
      {...responder.panHandlers}
      accessible
      accessibilityLabel={`${signerRole.label} signature drawing area`}
      accessibilityHint={displayOnly ? 'Captured signature' : 'Draw the signature with a finger or stylus'}
      accessibilityRole={displayOnly ? 'image' : 'button'}
      onLayout={layout}
      style={[styles.pad, captureDisabled && !displayOnly && styles.disabled]}
    >
      {liveValue.strokes.map((stroke) => (
        <Stroke
          key={stroke.strokeKey}
          stroke={stroke}
          width={size.width}
          height={size.height}
        />
      ))}
      {!signed ? <View pointerEvents="none" style={styles.placeholder}>
        <MaterialCommunityIcons name="gesture-tap-hold" size={31} color={colours.muted} />
        <Text style={styles.placeholderText}>Sign here</Text>
      </View> : null}
    </View>
    <View style={styles.footer}>
      <Text accessibilityLiveRegion="polite" style={styles.meta}>
        {signed ? `${liveValue.strokes.length} stroke${liveValue.strokes.length === 1 ? '' : 's'} captured` : 'No signature strokes captured'}
      </Text>
      {!displayOnly ? <Pressable
        accessibilityRole="button"
        disabled={captureDisabled || !liveValue.strokes.length}
        onPress={() => setLiveValue((current) => ({
          ...current,
          strokes: [],
          capturedAt: '',
        }))}
        style={({ pressed }) => [styles.clear, pressed && styles.pressed, (!liveValue.strokes.length || captureDisabled) && styles.disabled]}
      >
        <Text style={styles.clearText}>Clear signature</Text>
      </Pressable> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  heading: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  title: { color: colours.ink, fontSize: 17, fontWeight: '800' },
  meta: { color: colours.muted, fontSize: 12, lineHeight: 17 },
  declaration: { backgroundColor: colours.mint, borderColor: colours.mintStrong, borderRadius: radius.sm, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  declarationLabel: { color: colours.green, fontSize: 11, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  declarationText: { color: colours.ink, fontSize: 14, lineHeight: 20 },
  boundIdentity: { backgroundColor: colours.mint, borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  boundIdentityLabel: { color: colours.green, fontSize: 11, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  boundIdentityName: { color: colours.ink, fontSize: 17, fontWeight: '800' },
  pad: { backgroundColor: colours.white, borderColor: colours.green, borderRadius: radius.sm, borderWidth: 2, height: PAD_HEIGHT, overflow: 'hidden', position: 'relative' },
  segment: { backgroundColor: colours.ink, borderRadius: 2, height: 3, position: 'absolute' },
  placeholder: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  placeholderText: { color: colours.muted, fontSize: 16, fontWeight: '700', marginTop: spacing.xs },
  footer: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  clear: { borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, minHeight: 42, justifyContent: 'center', paddingHorizontal: spacing.md },
  clearText: { color: colours.red, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
