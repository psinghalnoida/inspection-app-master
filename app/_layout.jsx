import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, View } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AppColors } from '../constants/theme';
import { getAccessToken, getUserRole, removeTokens, saveTokens, saveUser, saveUserRole } from '../lib/storage';
import offlineDb from '../lib/offlineDb';
import syncService from '../lib/syncService';
import { useOnlineCallback } from '../hooks/useNetworkStatus';
import api from '../lib/api';
import UpdateGate from '../components/UpdateGate';

// We surface the "Go to Settings" alert at most once per app session — repeatedly
// nagging the surveyor every time they foreground the app would be hostile.
let settingsAlertShown = false;

/**
 * Push the surveyor's current GPS to the backend.
 * Called on cold start and whenever the app returns to the foreground.
 *
 * Permission flow:
 *  - Already granted → silently fetch + push.
 *  - Not granted but can ask → triggers the native permission prompt.
 *  - Denied with "don't ask again" → shows a one-shot alert with an "Open Settings" CTA.
 */
const pushSurveyorLocation = async () => {
  console.log('📍 [SurveyorLocation] Refresh triggered');
  try {
    let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    console.log(`📍 [SurveyorLocation] Permission status="${status}", canAskAgain=${canAskAgain}`);

    if (status !== 'granted') {
      if (canAskAgain) {
        console.log('📍 [SurveyorLocation] Prompting native permission dialog…');
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status;
        canAskAgain = req.canAskAgain;
        console.log(`📍 [SurveyorLocation] Permission after prompt="${status}", canAskAgain=${canAskAgain}`);
      }

      if (status !== 'granted') {
        console.log('📍 [SurveyorLocation] Permission not granted — skipping update');
        if (!settingsAlertShown) {
          settingsAlertShown = true;
          Alert.alert(
            'Location Permission Needed',
            'ClaimsMitra uses your location to match you with nearby survey requests. Please enable location access in Settings.',
            [
              { text: 'Not Now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
        }
        return;
      }
    }

    console.log('📍 [SurveyorLocation] Fetching current position…');
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const { latitude, longitude, accuracy } = location.coords;
    console.log(`📍 [SurveyorLocation] Got coords lat=${latitude}, lng=${longitude}, accuracy=${accuracy}m`);

    console.log('📍 [SurveyorLocation] Sending PUT /surveyor/location', { latitude, longitude });
    const res = await api.put('/surveyor/location', { latitude, longitude });
    console.log(`📍 [SurveyorLocation] Server response success=${res?.success ?? 'n/a'}, message="${res?.message ?? ''}"`);
  } catch (err) {
    console.warn('📍 [SurveyorLocation] Refresh failed:', err?.message, err);
  }
};

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

// Auth Context
const AuthContext = createContext({
  isAuthenticated: false,
  userRole: null,
  signIn: async () => { },
  signOut: async () => { },
});

export const useAuth = () => useContext(AuthContext);

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const dbInitialized = useRef(false);

  // Initialize offline database on app start
  useEffect(() => {
    const initOfflineDb = async () => {
      if (!dbInitialized.current) {
        console.log('🗄️ Initializing offline database...');
        await offlineDb.initDatabase();
        dbInitialized.current = true;
      }
    };
    initOfflineDb();
  }, []);

  // Auto-sync when coming back online
  useOnlineCallback(async () => {
    if (isAuthenticated && userRole === 'surveyor') {
      console.log('📡 Network restored - triggering auto-sync');
      const result = await syncService.triggerSync();
      if (result.success > 0) {
        console.log(`✅ Auto-synced ${result.success} uploads`);
      }
    }
  });

  // Refresh the surveyor's location in the DB whenever the app is opened —
  // both on cold start (once authenticated) and when returning from background.
  useEffect(() => {
    if (!isAuthenticated || userRole !== 'surveyor') return;

    // Cold-start / login push.
    pushSurveyorLocation();

    // Foreground return push.
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        pushSurveyorLocation();
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, userRole]);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = await getAccessToken();
      const role = await getUserRole();

      console.log('🔐 Auth check - Token exists:', !!token, 'Role:', role);

      if (!token || !role) {
        // No token or role, user is not authenticated
        console.log('❌ No token or role found, setting unauthenticated');
        setIsAuthenticated(false);
        setUserRole(null);
        return;
      }

      // We have stored credentials, assume authenticated
      // The api client will handle token refresh if needed when making requests
      console.log('✅ Auth restored - Role:', role);
      setIsAuthenticated(true);
      setUserRole(role);

    } catch (error) {
      console.error('Auth check error:', error);
      setIsAuthenticated(false);
      setUserRole(null);
    } finally {
      setIsLoading(false);
      SplashScreen.hideAsync();
    }
  };

  // Sign in function to update auth state
  const signIn = async (tokens, user, role) => {
    await saveTokens(tokens.accessToken, tokens.refreshToken);
    await saveUser(user);
    await saveUserRole(role);
    setIsAuthenticated(true);
    setUserRole(role);
  };

  // Sign out function to clear auth state
  const signOut = async () => {
    console.log('🚪 AuthContext: Starting sign out flow...');
    try {
      // Try to get token/role before clearing, for server-side removal
      const token = await getAccessToken();
      const role = await getUserRole();

      if (token && role) {
        // Remove FCM token from backend before clearing local auth
        try {
          const { removeTokenFromBackend } = require('../lib/notifications');
          await removeTokenFromBackend();
        } catch (error) {
          console.error('⚠️ AuthContext: Error removing token from backend:', error);
        }
      } else {
        console.log('ℹ️ AuthContext: No active session found during sign out, proceeding with local cleanup');
      }

      // Cleanup local state regardless of server-side success
      await removeTokens();
      await offlineDb.clearAllCache();
      console.log('✅ AuthContext: Local storage and cache cleared');
      
    } catch (error) {
      console.error('❌ AuthContext: Critical error during sign out:', error);
    } finally {
      setIsAuthenticated(false);
      setUserRole(null);
    }
  };

  // Handle navigation based on auth state
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'login' || segments[0] === 'verification' || segments[0] === 'role-selection' || segments[0] === 'surveyor-profile' || segments[0] === 'submission-status' || segments[0] === 'splash';
    const inSurveyorTabs = segments[0] === '(surveyor-tabs)';
    const inAssignerTabs = segments[0] === '(tabs)';

    if (!isAuthenticated && !inAuthGroup) {
      // User is not authenticated, redirect to splash (which will then go to login)
      router.replace('/splash');
    } else if (isAuthenticated && inAuthGroup) {
      // User is authenticated but on auth screen, redirect to appropriate home
      if (userRole === 'surveyor') {
        router.replace('/(surveyor-tabs)');
      } else {
        router.replace('/(tabs)');
      }
    } else if (isAuthenticated && userRole === 'assigner' && inSurveyorTabs) {
      // Assigner is on surveyor tabs, redirect to assigner tabs
      console.log('🔄 Assigner on wrong tabs, redirecting to (tabs)');
      router.replace('/(tabs)');
    } else if (isAuthenticated && userRole === 'surveyor' && inAssignerTabs) {
      // Surveyor is on assigner tabs, redirect to surveyor tabs
      console.log('🔄 Surveyor on wrong tabs, redirecting to (surveyor-tabs)');
      router.replace('/(surveyor-tabs)');
    }
  }, [isLoading, isAuthenticated, segments, userRole]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F7' }}>
        <ActivityIndicator size="large" color={AppColors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
    <AuthContext.Provider value={{ isAuthenticated, userRole, signIn, signOut }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {!isAuthenticated && segments[0] !== 'login' && segments[0] !== 'verification' && segments[0] !== 'role-selection' && segments[0] !== 'splash' && segments[0] !== 'submission-status' && segments[0] !== 'surveyor-profile' ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F7' }}>
            <ActivityIndicator size="large" color={AppColors.primary} />
          </View>
        ) : (
          <Stack>
            <Stack.Screen name="splash" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="verification" options={{ headerShown: false }} />
            <Stack.Screen name="role-selection" options={{ headerShown: false }} />
            <Stack.Screen name="surveyor-profile" options={{ headerShown: false }} />
            <Stack.Screen name="submission-status" options={{ headerShown: false }} />
            <Stack.Screen name="welcome-onboard" options={{ headerShown: false }} />
            <Stack.Screen name="set-mpin" options={{ headerShown: false }} />
            <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
            <Stack.Screen name="change-password" options={{ headerShown: false }} />
            <Stack.Screen name="terms" options={{ headerShown: false }} />
            <Stack.Screen name="privacy" options={{ headerShown: false }} />
            <Stack.Screen name="surveyor-edit-profile" options={{ headerShown: false }} />
            <Stack.Screen name="surveyor-change-password" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="(surveyor-tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="motor-spot-survey" options={{ headerShown: false }} />
            <Stack.Screen name="motor-final-survey" options={{ headerShown: false }} />
            <Stack.Screen name="marine-spot-survey" options={{ headerShown: false }} />
            <Stack.Screen name="inspection-investigation" options={{ headerShown: false }} />
            <Stack.Screen name="survey-detail/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="surveyor-execution/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="surveyor-tracking/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="notifications" options={{ headerShown: false }} />
            <Stack.Screen name="wallet" options={{ headerShown: false }} />
            <Stack.Screen name="ledger" options={{ headerShown: false }} />
            <Stack.Screen name="payment" options={{ headerShown: false }} />
            <Stack.Screen name="dispute/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
        )}
        <StatusBar style="dark" />
        {/* Admin-controlled force/optional update dialog (overlays everything) */}
        <UpdateGate />
      </ThemeProvider>
    </AuthContext.Provider>
    </SafeAreaProvider>
  );
}
