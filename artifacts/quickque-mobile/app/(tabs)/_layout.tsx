import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useColors } from '@/hooks/useColors';

const tabs = [
  { name: 'index', label: 'Scripts', sf: 'doc.text', sfSelected: 'doc.text.fill', icon: 'file-text' },
  { name: 'audio', label: 'Audio', sf: 'waveform', sfSelected: 'waveform', icon: 'headphones' },
  { name: 'remote', label: 'Remote', sf: 'iphone.gen3', sfSelected: 'iphone.gen3', icon: 'smartphone' },
  { name: 'settings', label: 'Settings', sf: 'gearshape', sfSelected: 'gearshape.fill', icon: 'settings' },
] as const;

function NativeTabLayout() {
  return <NativeTabs>{tabs.map(tab => (
    <NativeTabs.Trigger key={tab.name} name={tab.name}>
      <NativeTabs.Trigger.Icon sf={{ default: tab.sf, selected: tab.sfSelected }} />
      <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
  ))}</NativeTabs>;
}

function ClassicTabLayout() {
  const colors = useColors();
  const dark = useColorScheme() === 'dark';
  const ios = Platform.OS === 'ios';
  const web = Platform.OS === 'web';
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.mutedForeground,
      tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
      tabBarStyle: { position: 'absolute', backgroundColor: ios ? 'transparent' : colors.background, borderTopColor: colors.border, height: web ? 84 : undefined },
      tabBarBackground: () => ios ? <BlurView intensity={90} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />,
    }}>
      {tabs.map(tab => <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label, tabBarIcon: ({ color }) => ios ? <SymbolView name={tab.sf} tintColor={color} size={23} /> : <Feather name={tab.icon} size={21} color={color} /> }} />)}
    </Tabs>
  );
}

export default function TabLayout() {
  return isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;
}