import { Feather } from '@expo/vector-icons';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export default function RemoteScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 18), paddingBottom: insets.bottom + 90 }]}>
    <Text style={[styles.eyebrow, { color: colors.primary }]}>MAC REMOTE</Text><Text style={[styles.title, { color: colors.foreground }]}>Keep your Mac in position.</Text><Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Control Quickque from your iPhone on the same trusted local network.</Text>
    <View style={[styles.phone, { borderColor: colors.border, backgroundColor: colors.card }]}><View style={[styles.notch, { backgroundColor: colors.foreground }]} /><Feather name="smartphone" size={46} color={colors.primary} /><Text style={[styles.waiting, { color: colors.foreground }]}>Pairing comes next</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Camera QR scanning and LAN control need native protocol integration. This Expo Go preview keeps the state honest instead of showing a fake connection.</Text></View>
    <View style={[styles.notice, { backgroundColor: colors.accent }]}><Feather name="shield" size={20} color={colors.accentForeground} /><Text style={[styles.noticeText, { color: colors.accentForeground }]}>Pair only on a trusted network. Local remote traffic is not encrypted.</Text></View>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 2.4, marginBottom: 9 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 34, lineHeight: 39, letterSpacing: -1.2, maxWidth: 340 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 23, marginTop: 12, maxWidth: 330 },
  phone: { flex: 1, marginVertical: 26, borderWidth: 1, borderRadius: 30, alignItems: 'center', justifyContent: 'center', padding: 30 },
  notch: { width: 68, height: 5, borderRadius: 3, position: 'absolute', top: 14 },
  waiting: { fontFamily: 'Inter_600SemiBold', fontSize: 20, marginTop: 22 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  notice: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 16, alignItems: 'center' },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
});