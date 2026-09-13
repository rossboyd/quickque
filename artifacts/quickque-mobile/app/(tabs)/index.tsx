import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuickque, type Script } from '@/context/QuickqueContext';
import { useColors } from '@/hooks/useColors';

export default function LibraryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { scripts, ready, createScript, duplicateScript, trashScript, restoreScript, deleteForever } = useQuickque();
  const [query, setQuery] = useState('');
  const [trash, setTrash] = useState(false);
  const visible = useMemo(() => scripts.filter(script => Boolean(script.trashedAt) === trash && `${script.title} ${script.body}`.toLowerCase().includes(query.toLowerCase())), [scripts, trash, query]);

  const add = () => router.push({ pathname: '/script/[id]', params: { id: createScript() } });
  const menu = (script: Script) => Alert.alert(script.title, undefined, trash ? [
    { text: 'Restore', onPress: () => restoreScript(script.id) },
    { text: 'Delete forever', style: 'destructive', onPress: () => Alert.alert('Delete forever?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => deleteForever(script.id) }]) },
    { text: 'Cancel', style: 'cancel' },
  ] : [
    { text: 'Duplicate', onPress: () => duplicateScript(script.id) },
    { text: 'Move to Trash', style: 'destructive', onPress: () => trashScript(script.id) },
    { text: 'Cancel', style: 'cancel' },
  ]);

  if (!ready) return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 12) }]}>
      <View style={styles.header}>
        <View><Text style={[styles.eyebrow, { color: colors.primary }]}>QUICKQUE</Text><Text style={[styles.title, { color: colors.foreground }]}>Your scripts</Text></View>
        <Pressable testID="new-script" onPress={add} style={({ pressed }) => [styles.add, { backgroundColor: colors.primary, opacity: pressed ? .7 : 1 }]}><Feather name="plus" size={24} color={colors.primaryForeground} /></Pressable>
      </View>
      <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name="search" size={18} color={colors.mutedForeground} /><TextInput testID="script-search" value={query} onChangeText={setQuery} placeholder="Search every word" placeholderTextColor={colors.mutedForeground} style={[styles.searchInput, { color: colors.foreground }]} /></View>
      <View style={styles.switcher}>
        {([false, true] as const).map(value => <Pressable key={String(value)} onPress={() => { setTrash(value); Haptics.selectionAsync(); }} style={[styles.switchButton, !trash === !value && { backgroundColor: colors.accent }]}><Text style={[styles.switchText, { color: !trash === !value ? colors.accentForeground : colors.mutedForeground }]}>{value ? 'Trash' : 'Library'}</Text></Pressable>)}
      </View>
      <FlatList data={visible} keyExtractor={item => item.id} contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} scrollEnabled={visible.length > 0} ListEmptyComponent={<View style={styles.empty}><Feather name={trash ? 'trash-2' : 'file-text'} size={34} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{trash ? 'Trash is empty' : 'No scripts found'}</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{trash ? 'Removed scripts wait here until you restore or delete them.' : 'Create a script and give yourself something good to say.'}</Text></View>} renderItem={({ item }) => (
        <Pressable testID={`script-${item.id}`} onPress={() => trash ? menu(item) : router.push({ pathname: '/script/[id]', params: { id: item.id } })} style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? .72 : 1 }]}>
          <View style={[styles.line, { backgroundColor: colors.primary }]} />
          <View style={styles.cardCopy}><Text numberOfLines={1} style={[styles.cardTitle, { color: colors.cardForeground }]}>{item.title}</Text><Text numberOfLines={2} style={[styles.preview, { color: colors.mutedForeground }]}>{item.body || 'Start writing…'}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{Math.max(1, item.body.trim().split(/\s+/).filter(Boolean).length)} words</Text></View>
          <Pressable testID={`menu-${item.id}`} hitSlop={12} onPress={() => menu(item)}><Feather name="more-horizontal" size={22} color={colors.mutedForeground} /></Pressable>
        </Pressable>
      )} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 3, marginBottom: 5 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 32, letterSpacing: -1.2 },
  add: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  search: { height: 50, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 10 },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16 },
  switcher: { flexDirection: 'row', marginVertical: 16, gap: 8 },
  switchButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20 },
  switchText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  list: { gap: 11 },
  card: { minHeight: 126, borderWidth: 1, borderRadius: 18, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', paddingRight: 17 },
  line: { width: 4, alignSelf: 'stretch' },
  cardCopy: { flex: 1, padding: 17 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginBottom: 7 },
  preview: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  meta: { fontFamily: 'Inter_500Medium', fontSize: 11, marginTop: 10, textTransform: 'uppercase', letterSpacing: 1 },
  empty: { alignItems: 'center', paddingHorizontal: 36, paddingTop: 72 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 19, marginTop: 16 },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
});