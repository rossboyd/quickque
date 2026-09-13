import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuickque } from '@/context/QuickqueContext';
import colors from '@/constants/colors';

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { scriptById, settings, updateSettings } = useQuickque();
  const script = scriptById(id);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      offset.current += settings.speed / 20;
      scroll.current?.scrollTo({ y: offset.current, animated: false });
      setProgress(value => Math.min(1, value + settings.speed / 70000));
    }, 50);
    return () => clearInterval(timer);
  }, [playing, settings.speed]);

  if (!script) return null;
  return <View style={[styles.screen, { backgroundColor: colors.dark.reader }]}>
    <View style={[styles.top, { paddingTop: insets.top + 10 }]}><Pressable testID="exit-reader" onPress={() => router.back()} hitSlop={12}><Feather name="x" size={27} color={colors.dark.readerText} /></Pressable><Text numberOfLines={1} style={styles.scriptTitle}>{script.title}</Text><Text style={styles.percent}>{Math.round(progress * 100)}%</Text></View>
    <View style={styles.progress}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View>
    <ScrollView ref={scroll} onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} contentContainerStyle={[styles.copyWrap, { paddingBottom: 500 }]}>
      <Text style={[styles.copy, { fontSize: settings.fontSize, lineHeight: settings.fontSize * 1.48, textAlign: settings.alignment }]}>{script.body || 'This script is empty.'}</Text>
    </ScrollView>
    <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
      <Pressable testID="smaller-text" onPress={() => updateSettings({ fontSize: Math.max(24, settings.fontSize - 2) })}><Feather name="minus" size={22} color={colors.dark.readerText} /></Pressable>
      <Pressable testID="toggle-reader" onPress={() => { setPlaying(value => !value); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }} style={styles.play}><Feather name={playing ? 'pause' : 'play'} size={25} color={colors.dark.primaryForeground} /></Pressable>
      <Pressable testID="larger-text" onPress={() => updateSettings({ fontSize: Math.min(64, settings.fontSize + 2) })}><Feather name="plus" size={22} color={colors.dark.readerText} /></Pressable>
      <View style={styles.speed}><Feather name="wind" size={17} color={colors.dark.mutedForeground} /><Pressable testID="slower" onPress={() => updateSettings({ speed: Math.max(10, settings.speed - 4) })}><Text style={styles.speedText}>−</Text></Pressable><Text style={styles.speedValue}>{settings.speed}</Text><Pressable testID="faster" onPress={() => updateSettings({ speed: Math.min(80, settings.speed + 4) })}><Text style={styles.speedText}>+</Text></Pressable></View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: 18, paddingBottom: 15, flexDirection: 'row', alignItems: 'center', gap: 14 },
  scriptTitle: { flex: 1, fontFamily: 'Inter_600SemiBold', color: colors.dark.readerText, fontSize: 14 },
  percent: { fontFamily: 'Inter_600SemiBold', color: colors.dark.mutedForeground, fontSize: 12 },
  progress: { height: 2, backgroundColor: colors.dark.border },
  progressFill: { height: 2, backgroundColor: colors.dark.primary },
  copyWrap: { paddingHorizontal: 25, paddingTop: 150 },
  copy: { fontFamily: 'Inter_500Medium', color: colors.dark.readerText },
  controls: { marginHorizontal: 14, paddingTop: 12, paddingHorizontal: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.dark.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  play: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.dark.primary, alignItems: 'center', justifyContent: 'center' },
  speed: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  speedText: { color: colors.dark.readerText, fontFamily: 'Inter_600SemiBold', fontSize: 20 },
  speedValue: { color: colors.dark.mutedForeground, fontFamily: 'Inter_600SemiBold', fontSize: 12, minWidth: 20, textAlign: 'center' },
});