import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TABS = [
  { name: 'index', icon: 'home', label: 'Home' },
  { name: 'survey', icon: 'assignment', label: 'Survey' },
  { name: 'surveys', icon: 'assignment', label: 'Surveys' },
  { name: 'profile', icon: 'person-outline', label: 'Profile' },
];

// Tab bar pill height (paddingVertical 12 + tab paddingVertical 10*2 + icon 24) ≈ 68.
// Gap between pill and the device bottom edge / nav bar.
export const TAB_BAR_HEIGHT = 68;
export const TAB_BAR_GAP = 12;

// Use in scrollable content as paddingBottom so items aren't hidden behind the floating tab bar.
export function useTabBarClearance() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TAB_BAR_GAP + insets.bottom + 16;
}

export default function CustomTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { bottom: insets.bottom + TAB_BAR_GAP }]}>
      <View style={styles.tabBar}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const tab = TABS.find(t => t.name === route.name) || TABS[index];

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              style={[styles.tab, isFocused && styles.activeTab]}
              activeOpacity={0.7}
            >
              <MaterialIcons
                name={tab?.icon || 'circle'}
                size={24}
                color="#FFF"
              />
              {isFocused && <Text style={styles.label}>{tab?.label}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 20,
    right: 20,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#6852CC',
    borderRadius: 32,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    gap: 8,
  },
  activeTab: {
    backgroundColor: '#B29EF4',
  },
  label: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
