import { Feather } from '@expo/vector-icons';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuickque } from '@/context/QuickqueContext';
import { useColors } from '@/hooks/useColors';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, resetData } = useQuickque();
  const adjust = (key: 'fontSize' | 'speed', amount: number) => updateSettings({ [key]: Math.max(key === 'fontSize' ? 24 : 10, Math.min(key === 'fontSize' ? 64 : 80, settings[key] + amount)) });
  return <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 18), paddingBottom: insets.bottom + 100 }]}>
    <Text style={[styles.eyebrow, { color: colors.primary }]}>QUICKQUE MOBILE</Text><Text style={[styles.title, { color: colors.foreground }]}>Reader defaults</Text>
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Setting label="Text size" value={`${settings.fontSize} pt`} onMinus={() => adjust('fontSize', -2)} onPlus={() => adjust('fontSize', 2)} colors={colors} />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Setting label="Scroll pace" value={`${settings.speed}`} onMinus={() => adjust('speed', -4)} onPlus={() => adjust('speed', 4)} colors={colors} />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Pressable testID="toggle-alignment" onPress={() => updateSettings({ alignment: settings.alignment === 'left' ? 'center' : 'left' })} style={styles.row}><Text style={[styles.label, { color: colors.foreground }]}>Alignment</Text><Text style={[styles.value, { color: colors.primary }]}>{settings.alignment === 'left' ? 'Left' : 'Centre'}</Text></Pressable>
    </View>
    <View style={[styles.privacy, { backgroundColor: colors.accent }]}><Feather name="lock" size={20} color={colors.accentForeground} /><View><Text style={[styles.privacyTitle, { color: colors.accentForeground }]}>Local by default</Text><Text style={[styles.privacyBody, { color: colors.accentForeground }]}>Scripts are saved on this device. No account or cloud service is used.</Text></View></View>
    <Pressable testID="reset-data" onPress={() => Alert.alert('Reset Quickque?', 'This removes your scripts and restores the welcome sample.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset', style: 'destructive', onPress: resetData }])} style={styles.reset}><Feather name="refresh-ccw" size={17} color={colors.destructive} /><Text style={[styles.resetText, { color: colors.destructive }]}>Reset local data</Text></Pressable>
  </View>;
}
function Setting({ label, value, onMinus, onPlus, colors }: { label: string; value: string; onMinus: () => void; onPlus: () => void; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.row}><Text style={[styles.label, { color: colors.foreground }]}>{label}</Text><View style={styles.control}><Pressable onPress={onMinus} hitSlop={8}><Feather name="minus" size={20} color={colors.mutedForeground} /></Pressable><Text style={[styles.value, { color: colors.foreground }]}>{value}</Text><Pressable onPress={onPlus} hitSlop={8}><Feather name="plus" size={20} color={colors.primary} /></Pressable></View></View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 2.4, marginBottom: 9 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 34, letterSpacing: -1.2, marginBottom: 26 },
  card: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 18 },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  control: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  value: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textTransform: 'capitalize' },
  divider: { height: StyleSheet.hairlineWidth },
  privacy: { marginTop: 20, padding: 18, borderRadius: 18, flexDirection: 'row', gap: 13, alignItems: 'flex-start' },
  privacyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 4 },
  privacyBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, maxWidth: 275 },
  reset: { marginTop: 'auto', flexDirection: 'row', justifyContent: 'center', gap: 9, paddingVertical: 16 },
  resetText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});