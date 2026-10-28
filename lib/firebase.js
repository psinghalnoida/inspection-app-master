/**
 * Firebase Cloud Messaging via @react-native-firebase/messaging
 *
 * Why not expo-notifications' getDevicePushTokenAsync()?
 *   - On Android it returns an FCM registration token (works with our Firebase
 *     Admin backend).
 *   - On iOS it returns the raw APNs device token, NOT an FCM registration token.
 *     Our backend sends through the Firebase Admin SDK, which only accepts FCM
 *     registration tokens, so every iOS push was silently rejected
 *     (messaging/invalid-registration-token) and the token marked inactive.
 *
 * RNFirebase mints a real FCM token on both platforms. On iOS it takes the APNs
 * token and exchanges it with FCM (Firebase then delivers to APNs using the APNs
 * auth key uploaded in the Firebase console).
 */

import { Platform } from 'react-native';

// Guarded require so web / non-native bundles don't crash on import.
let messaging = null;
try {
    messaging = require('@react-native-firebase/messaging').default;
} catch {
    messaging = null;
}

const isAvailable = () => !!messaging && Platform.OS !== 'web';

/**
 * iOS needs the APNs token before FCM can mint a registration token. Right after
 * permission is granted it can take a moment to arrive, so we poll briefly.
 */
async function ensureApnsToken(retries = 6, delayMs = 1000) {
    for (let i = 0; i < retries; i++) {
        const apns = await messaging().getAPNSToken();
        if (apns) return apns;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
}

/**
 * Get the FCM registration token (works on iOS and Android).
 */
export async function getFCMToken() {
    if (!isAvailable()) {
        console.log('⚠️ FCM not available on this platform');
        return null;
    }

    try {
        // iOS must be registered for remote messages before a token can be minted.
        if (Platform.OS === 'ios' && !messaging().isDeviceRegisteredForRemoteMessages) {
            await messaging().registerDeviceForRemoteMessages();
        }

        if (Platform.OS === 'ios') {
            const apns = await ensureApnsToken();
            if (!apns) {
                console.warn(
                    '⚠️ APNs token unavailable — FCM token may fail. ' +
                    'Verify Push Notifications capability, aps-environment entitlement, ' +
                    'and that the APNs auth key is uploaded in Firebase.'
                );
            }
        }

        const token = await messaging().getToken();
        console.log('📱 FCM Token:', token ? token.slice(0, 30) + '...' : token);
        return token || null;
    } catch (error) {
        console.error('❌ Error getting FCM token:', error);
        return null;
    }
}

/**
 * Foreground message handler. Returns an unsubscribe function.
 */
export function onForegroundMessage(callback) {
    if (!isAvailable()) return () => {};

    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
        console.log('📬 Foreground FCM message received:', remoteMessage?.messageId);
        if (callback) callback(remoteMessage);
    });

    return unsubscribe;
}

// Register a background handler so RNFirebase doesn't warn and data-only messages
// are processed when the app is backgrounded/killed. Backend currently sends a
// `notification` payload (displayed automatically by the OS) plus a `data` block.
if (isAvailable()) {
    try {
        messaging().setBackgroundMessageHandler(async (remoteMessage) => {
            console.log('📬 Background FCM message:', remoteMessage?.messageId);
        });
    } catch {
        // no-op
    }
}

export default {
    getFCMToken,
    onForegroundMessage,
};
