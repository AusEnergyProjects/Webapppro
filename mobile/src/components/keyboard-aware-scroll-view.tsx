import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Keyboard, ScrollView, TextInput, View, type ScrollViewProps } from 'react-native';
import { createKeyboardScrollCoordinator } from '@/lib/keyboard-scroll';

export const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardAwareScrollView({
  children, onFocus, onBlur, onLayout, onContentSizeChange, onScroll,
  keyboardDismissMode = 'on-drag', keyboardShouldPersistTaps = 'handled', ...props
}, forwardedRef) {
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const [bottomSpace, setBottomSpace] = useState(0);
  const [coordinator] = useState(() => createKeyboardScrollCoordinator({
    getFocusedInput: () => TextInput.State.currentlyFocusedInput(),
    measureViewport: (callback) => scroll.current?.getNativeScrollRef()?.measureInWindow(callback),
    getOffset: () => offset.current,
    scrollTo: (y) => scroll.current?.scrollTo({ y, animated: false }),
    setBottomSpace,
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
  }));
  useImperativeHandle(forwardedRef, () => scroll.current!, []);
  useEffect(() => {
    coordinator.activate();
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', (event) => coordinator.keyboardChanged(event.endCoordinates)),
      Keyboard.addListener('keyboardDidChangeFrame', (event) => coordinator.keyboardChanged(event.endCoordinates)),
      Keyboard.addListener('keyboardDidHide', () => coordinator.keyboardHidden()),
    ];
    return () => { subscriptions.forEach((subscription) => subscription.remove()); coordinator.dispose(); };
  }, [coordinator]);

  return <ScrollView {...props} ref={scroll}
    automaticallyAdjustKeyboardInsets={false}
    keyboardDismissMode={keyboardDismissMode} keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    scrollEventThrottle={16}
    // The innermost viewport owns its input, including when a native modal bubbles through its React parent.
    onFocus={(event) => { event.stopPropagation(); coordinator.focus(Keyboard.metrics()); onFocus?.(event); }}
    onBlur={(event) => { event.stopPropagation(); coordinator.blur(); onBlur?.(event); }}
    onLayout={(event) => { coordinator.layoutChanged(); onLayout?.(event); }}
    onContentSizeChange={(width, height) => { coordinator.layoutChanged(); onContentSizeChange?.(width, height); }}
    onScroll={(event) => { offset.current = event.nativeEvent.contentOffset.y; onScroll?.(event); }}
  >{children}<View pointerEvents="none" accessible={false} style={{ height: bottomSpace }} /></ScrollView>;
});
