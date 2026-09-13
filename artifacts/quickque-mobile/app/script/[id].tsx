import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useQuickque } from '@/context/QuickqueContext';
import { useColors } from '@/hooks/useColors';

export default function ScriptEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { scriptById, updateScript } = useQuickque();
  const script = scriptById(id);
  const [title, setTitle] = useState(script?.title ?? '');
  const [body, setBody] = useState(script?.body ?? '');
  const save = () => { if (script) updateScript(script.id, { title: title.trim() || 'Untitled script', body }); router.back(); };
  if (!script) return <View style={[styles.missing, { backgroundColor: colors.background }]}><Text style={{ color: colors.foreground }}>Script not found.</Text></View>;
  return <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
    <View style={styles.header}><Pressable testID="close-editor" onPress={save} hitSlop={12}><Feather name="chevron-left" size={28} color={colors.foreground} /></Pressable><Text style={[styles.headerTitle, { color: colors.mutedForeground }]}>EDIT SCRIPT</Text><Pressable testID="open-reader" onPress={() => { updateScript(script.id, { title: title.trim() || 'Untitled script', body }); router.push({ pathname: '/reader/[id]', params: { id: script.id } }); }} style={[styles.read, { backgroundColor: colors.primary }]}><Feather name="play" size={16} color={colors.primaryForeground} /><Text style={[styles.readText, { color: colors.primaryForeground }]}>Read</Text></Pressable></View>
    <KeyboardAwareScrollViewCompat style={styles.flex} contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 40 }]} bottomOffset={30}>
      <TextInput testID="script-title" value={title} onChangeText={setTitle} placeholder="Script title" placeholderTextColor={colors.mutedForeground} style={[styles.title, { color: colors.foreground }]} />
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <TextInput testID="script-body" value={body} onChangeText={setBody} multiline textAlignVertical="top" placeholder="Start with the words you want to say…" placeholderTextColor={colors.mutedForeground} style={[styles.body, { color: colors.foreground }]} />
    </KeyboardAwareScrollViewCompat>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { height: 62, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 2 },
  read: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 15, height: 38, borderRadius: 19 },
  readText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  form: { paddingHorizontal: 22, flexGrow: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1, paddingVertical: 18 },
  rule: { height: 1 },
  body: { minHeight: 480, fontFamily: 'Inter_400Regular', fontSize: 18, lineHeight: 29, paddingTop: 22 },
});