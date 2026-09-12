import Svg, { Path, Circle, G, Rect } from 'react-native-svg';

/**
 * The same line icons the web app draws, on the same 24px grid with the same
 * 1.7 stroke.
 *
 * The path data is copied deliberately rather than shared through a package:
 * Metro would have to resolve a TypeScript workspace at runtime for a handful
 * of glyphs, and the web set is plain SVG that renders identically here. If one
 * side changes shape, the other should be changed to match.
 *
 * The tab bar had no icons at all -- `Tabs.Screen` was declared without
 * `tabBarIcon`, so every tab showed a label over empty space.
 */

type IconProps = { size?: number; color?: string };

/**
 * Stroke geometry. The colour is applied on the group rather than through
 * `currentColor`: the tab bar hands the icon an explicit colour per state, and
 * an inherited keyword that fails to resolve renders an invisible icon -- which
 * is indistinguishable from the missing-icon bug this file exists to fix.
 */
const stroke = {
  fill: 'none' as const,
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Frame({ size = 24, color, children }: IconProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G stroke={color ?? '#0f1420'}>{children}</G>
    </Svg>
  );
}

/** New task. */
export function PlusIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Path {...stroke} d="M12 5v14M5 12h14" />
    </Frame>
  );
}

/** Your tasks. */
export function ClockIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Circle {...stroke} cx="12" cy="12" r="8.5" />
      <Path {...stroke} d="M12 7.5V12l3 1.8" />
    </Frame>
  );
}

/** Contacts: an address book, distinct from the results target. */
export function ContactsIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Path {...stroke} d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z" />
      <Path {...stroke} d="M6 3.5v17" />
      <Path {...stroke} d="M3.5 7.5H6M3.5 12H6M3.5 16.5H6" />
      <Circle {...stroke} cx="12.5" cy="10" r="2" />
      <Path {...stroke} d="M9.5 16c.4-1.6 1.6-2.5 3-2.5s2.6.9 3 2.5" />
    </Frame>
  );
}

/** Settings. */
export function SettingsIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Circle {...stroke} cx="12" cy="12" r="3" />
      <Path
        {...stroke}
        d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"
      />
    </Frame>
  );
}

/** Placing a call. */
export function PhoneCallIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Path
        {...stroke}
        d="M15.5 10.5a4 4 0 0 0-3-3M18.5 10a7 7 0 0 0-5.5-5.5"
      />
      <Path
        {...stroke}
        d="M5.5 4h3l1.5 3.6-2 1.2a11 11 0 0 0 5.2 5.2l1.2-2 3.6 1.5v3a1.7 1.7 0 0 1-1.9 1.7A15.6 15.6 0 0 1 3.8 5.9 1.7 1.7 0 0 1 5.5 4z"
      />
    </Frame>
  );
}

/** Location, shared with the web composer's "Use my location" control. */
export function MapPinIcon({ size = 16, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Path {...stroke} d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <Circle {...stroke} cx="12" cy="10" r="2.5" />
    </Frame>
  );
}

/** Usage: a payment card, matching the web's Usage entry. */
export function CardIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Rect {...stroke} x="3" y="5.5" width="18" height="13" rx="2" />
      <Path {...stroke} d="M3 10h18" />
    </Frame>
  );
}

/** Permissions. */
export function KeyIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Circle {...stroke} cx="8" cy="12" r="3.5" />
      <Path {...stroke} d="M11.5 12H21M18 12v3M15 12v2.2" />
    </Frame>
  );
}

/** Profile. */
export function UserIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Circle {...stroke} cx="12" cy="8.5" r="3.5" />
      <Path {...stroke} d="M5 19.5a7 7 0 0 1 14 0" />
    </Frame>
  );
}

/** Business. */
export function BriefcaseIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Rect {...stroke} x="3" y="7.5" width="18" height="12" rx="2" />
      <Path {...stroke} d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
    </Frame>
  );
}

/** A scheduled run. */
export function CalendarIcon({ size, color }: IconProps) {
  return (
    <Frame size={size} color={color}>
      <Rect {...stroke} x="3.5" y="5.5" width="17" height="15" rx="2" />
      <Path {...stroke} d="M3.5 10h17M8 3.5v4M16 3.5v4" />
    </Frame>
  );
}
