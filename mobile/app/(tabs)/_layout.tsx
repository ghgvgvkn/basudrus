/**
 * Tab bar — full-width, bottom-pinned (Instagram / TikTok pattern).
 *
 * Why this shape and not the floating pill:
 *   • Floating pills crowd content (Discover cards getting clipped
 *     at the bottom) and disappear behind composers (AI chat input
 *     overlapping / hiding the bar). A flush-mounted bottom bar
 *     never moves and never overlaps content because every screen
 *     can reliably reserve `49pt + bottom-inset` of room for it.
 *   • Instagram, TikTok, Threads, X, YouTube all use this exact
 *     pattern: full-width, hugging the bottom edge, with the home-
 *     indicator safe area handled by the bar itself.
 *
 * Visual style — frosted bottom bar:
 *   • iOS gets a BlurView with `systemChromeMaterial` so the surface
 *     beneath softly bleeds through (same liquid-glass feel as
 *     Apple's own tab bars).
 *   • Hairline top border — the standard separator UIKit uses.
 *   • Soft shadow above the bar to lift it off the content.
 *
 * Tabs (left → right): Home · Discover · AI · Messages · Profile.
 *   • All five tabs are equal-weight — no raised AI FAB. AI uses
 *     the Lucide Sparkles glyph at the same size as the others.
 *
 * Active state:
 *   • Icon + label both tint to c.accent (theme purple — #5B4BF5
 *     light / #9688FF dark).
 *   • Label fontWeight: medium (500) inactive → semibold (600) active.
 *
 * Why tabBarButton (and NOT tabBarIcon + tabBarLabel slots):
 *   React Navigation's tabBarIcon slot has a default max width that
 *   doesn't expand to the cell — labels like "Discover" / "Messages"
 *   get ellipsized to "Dis..." / "Me..." even when the cell has room.
 *   tabBarButton fully replaces the touchable with our Pressable at
 *   flex:1, so labels get the full cell width to lay out in.
 *
 * The rooms screen is still a push route (href: null) so it stays
 * navigable via router.push without showing in the bar.
 */
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import {
  Home,
  Compass,
  Sparkles,
  MessageSquare,
  User,
} from 'lucide-react-native';

import { useTheme } from '@/context/ThemeContext';
import { tap } from '@/lib/haptics';

// Lucide icons render at 22pt to match `h-[22px]` on the website.
const TAB_ICON_SIZE = 22;
// Inner bar height (above the safe-area inset). 56pt matches
// Instagram / TikTok / Threads — comfortable target without
// eating screen height.
const BAR_HEIGHT = 56;

/**
 * Permissive icon-component type so TabButton can render both the
 * standard Lucide icons AND our custom AISparklesIcon (a purple
 * circle with a filled Sparkles inside). Both accept the same
 * `size`/`color`/`strokeWidth` props so they're interchangeable.
 */
type TabIconComponent = React.ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

/**
 * AISparklesIcon — the AI tab's special icon.
 *
 * A small purple circle with a white filled Sparkles glyph inside,
 * matching the reference the user provided. Critically:
 *   • Outer dimensions match TAB_ICON_SIZE exactly (22pt) — same
 *     box as every other tab icon, so the AI tab cell lays out
 *     identically to the others. No extra padding, no clipping,
 *     no gap shifts.
 *   • The inner Sparkles is sized as a fraction of the circle so
 *     if we ever bump TAB_ICON_SIZE, the inner glyph scales with it.
 *   • Hairline white rim suggests the soft glow from the reference
 *     image without adding shadow weight.
 */
function AISparklesIcon({ size = TAB_ICON_SIZE }: {
  size?: number;
  // Accepted (and ignored) so the signature matches TabIconComponent.
  // The AI icon always uses its own purple fill + white sparkle, not
  // the active/inactive tint that the other tabs use.
  color?: string;
  strokeWidth?: number;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.accent,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255, 255, 255, 0.45)',
      }}
    >
      <Sparkles
        size={Math.round(size * 0.6)}
        color="#FFFFFF"
        fill="#FFFFFF"
        strokeWidth={1.5}
      />
    </View>
  );
}

/**
 * TabButton — fully replaces the default tab touchable.
 *
 * Renders icon + label as a single tight column at flex:1, so the
 * label has the entire cell width to fit in (not just the narrow
 * tabBarIcon slot which would force "Ho..." / "Dis..." ellipsis).
 *
 * iconSize and iconLabelGap are per-tab overrides so the AI tab can
 * use a chunkier circle + a roomier gap to its label, while every
 * other tab stays at the standard 22pt icon / 2pt gap. justifyContent
 * stays 'center', so the larger AI icon nudges the AI label down
 * slightly relative to the other tabs without breaking horizontal
 * alignment of the row.
 */
function TabButton({
  Icon,
  iconSize = TAB_ICON_SIZE,
  iconLabelGap = 2,
  labelSize = 10.5,
  label,
  activeColor,
  inactiveColor,
  onPress,
  onLongPress,
  accessibilityState,
}: BottomTabBarButtonProps & {
  Icon: TabIconComponent;
  iconSize?: number;
  iconLabelGap?: number;
  /** Override the label fontSize. Line-height auto-scales with it. */
  labelSize?: number;
  label: string;
  activeColor: string;
  inactiveColor: string;
}) {
  const focused = accessibilityState?.selected ?? false;
  const color = focused ? activeColor : inactiveColor;

  return (
    <Pressable
      onPress={(e) => {
        tap();
        onPress?.(e);
      }}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      style={({ pressed }) => [
        styles.tabBtn,
        {
          opacity: pressed ? 0.65 : 1,
          // gap is set dynamically per tab so the AI cell can breathe
          // a little more between its circle and the label.
          gap: iconLabelGap,
        },
      ]}
    >
      <Icon size={iconSize} color={color} strokeWidth={2} />
      <Text
        numberOfLines={1}
        style={[
          styles.tabLabel,
          {
            color,
            fontWeight: focused ? '600' : '500',
            fontSize: labelSize,
            // Match RN's default lineHeight ratio of ~1.15× so the
            // bigger AI label doesn't get cramped vertically.
            lineHeight: Math.round(labelSize * 1.15),
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { mode, c } = useTheme();
  const insets = useSafeAreaInsets();
  const isDark = mode === 'dark';

  // Subtle top divider — same as the UIKit standard tab-bar rule.
  const divider = isDark
    ? 'rgba(255, 255, 255, 0.10)'
    : 'rgba(0, 0, 0, 0.08)';

  // Curried builder so each Tabs.Screen below stays a one-liner.
  // `opts` is the per-tab override hook — only the AI tab uses it
  // today, to bump its circle size and gap. The rest of the bar
  // takes the defaults (22pt icon, 2pt gap) so the row stays in
  // visual rhythm.
  const makeButton = (
    Icon: TabIconComponent,
    label: string,
    opts?: { iconSize?: number; iconLabelGap?: number; labelSize?: number },
  ) =>
    (props: BottomTabBarButtonProps) => (
      <TabButton
        Icon={Icon}
        iconSize={opts?.iconSize}
        iconLabelGap={opts?.iconLabelGap}
        labelSize={opts?.labelSize}
        label={label}
        activeColor={c.accent}
        inactiveColor={c.textMuted}
        {...props}
      />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          // Full-width, hugging the bottom — Instagram/TikTok pattern.
          // The bar's height is the inner height + the home-indicator
          // safe area, which the OS adds for us when we set the bar's
          // content height + paddingBottom.
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          // Hairline top border in lieu of UIKit's default rule.
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: divider,
          // Transparent so BlurView shows through on iOS. Android
          // falls back to a solid surface in tabBarBackground below.
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : c.bgElevated,
          elevation: 0,
        },
        tabBarItemStyle: {
          height: BAR_HEIGHT,
          paddingVertical: 0,
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView
              intensity={80}
              tint={
                isDark
                  ? 'systemChromeMaterialDark'
                  : 'systemChromeMaterialLight'
              }
              style={StyleSheet.absoluteFill}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarButton: makeButton(Home, 'Home'),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarButton: makeButton(Compass, 'Discover'),
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: 'AI',
          // 28pt circle (vs 22pt for other icons) gives the AI tab
          // more visual weight. 5pt gap (vs 2pt) pushes the "AI"
          // label down slightly. labelSize 12 (vs 10.5) makes the
          // "AI" word read a bit chunkier next to the bigger circle.
          // Total content height (28 + 5 + ~14) = 47pt, still well
          // inside the 56pt bar.
          tabBarButton: makeButton(AISparklesIcon, 'AI', {
            iconSize: 28,
            iconLabelGap: 5,
            labelSize: 12,
          }),
        }}
      />
      <Tabs.Screen
        name="connect"
        options={{
          title: 'Messages',
          tabBarButton: makeButton(MessageSquare, 'Messages'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarButton: makeButton(User, 'Profile'),
        }}
      />

      {/* Hidden — accessible via router.push */}
      <Tabs.Screen name="rooms" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBtn: {
    flex: 1,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    // gap is set inline in TabButton so it can vary per tab
    // (AI tab gets a roomier 5pt vs the default 2pt).
  },
  tabLabel: {
    fontSize: 10.5,
    letterSpacing: 0.1,
    lineHeight: 12,
  },
});
