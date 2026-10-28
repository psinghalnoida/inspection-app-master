/**
 * Push Notification Service for ClaimsMitra App
 * Handles FCM token registration and notification permissions
 */

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import api from './api';
import { getUserRole } from './storage';
import { getFCMToken, onForegroundMessage } from './firebase';

// Configure notification handler
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

/**
 * Register for push notifications and get FCM token
 */
export async function registerForPushNotifications() {
    let token;

    // Must be a physical device for push notifications to work
    if (!Device.isDevice) {
        console.log('⚠️ Push notifications require a physical device');
        return null;
    }

    // Check/request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.log('❌ Push notification permission not granted');
        return null;
    }

    try {
        // Use Firebase Cloud Messaging for Android/iOS
        console.log('🔥 Getting FCM token...');
        token = await getFCMToken();

        if (!token) {
            console.error('❌ Failed to get FCM token');
            return null;
        }

        console.log('✅ FCM Token obtained successfully');
    } catch (error) {
        console.error('❌ Error getting push token:', error);
        return null;
    }

    // Android-specific: Create notification channels
    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('claimsmitra_notifications', {
            name: 'ClaimsMitra Notifications',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF6B35',
            sound: 'default',
            enableVibrate: true,
            enableLights: true,
        });

        // Dedicated channel for new survey broadcast requests with a custom alert tone.
        // Android locks the sound onto the channel at creation time — if survey_alert.mp3
        // changes, bump the channel id (e.g. survey_requests_v2) here AND in the backend.
        await Notifications.setNotificationChannelAsync('survey_requests', {
            name: 'New Survey Requests',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 300, 200, 300],
            lightColor: '#FF6B35',
            sound: 'survey_alert',
            enableVibrate: true,
            enableLights: true,
            bypassDnd: false,
        });
    }

    return token;
}

/**
 * Register FCM token with backend
 */
export async function registerTokenWithBackend(fcmToken, deviceId = null) {
    try {
        const userRole = await getUserRole();
        if (!userRole || !fcmToken) {
            // Log as info, not warning, to reduce noise during session transitions
            console.log('ℹ️ Skipping token registration: missing role or token');
            return false;
        }

        const endpoint = userRole === 'surveyor'
            ? '/surveyor/notifications/register-token'
            : '/assigner/notifications/register-token';

        const response = await api.post(endpoint, {
            fcm_token: fcmToken,
            device_type: Platform.OS,
            device_id: deviceId || Device.modelId || 'unknown'
        });

        if (response.success) {
            console.log('✅ FCM token registered with backend');
            return true;
        } else {
            console.error('❌ Failed to register token:', response.message);
            return false;
        }
    } catch (error) {
        console.error('❌ Error registering token with backend:', error);
        return false;
    }
}

/**
 * Initialize complete notification system with FCM
 * This handles: token registration, background messages, foreground messages
 */
export async function initializeNotifications() {
    try {
        console.log('📱 Initializing notification system...');

        // Register for push notifications and get token
        const token = await registerForPushNotifications();

        if (!token) {
            console.log('⚠️ Could not initialize notifications: no token');
            return null;
        }

        // Register token with backend
        await registerTokenWithBackend(token);

        // Setup FCM foreground message handler
        const unsubscribeForeground = onForegroundMessage((message) => {
            console.log('📬 Received foreground notification:', message);
            // You can add custom handling here if needed
        });

        console.log('✅ Notification system initialized successfully');

        return {
            token,
            unsubscribe: unsubscribeForeground,
        };
    } catch (error) {
        console.error('❌ Error initializing notifications:', error);
        return null;
    }
}

/**
 * Remove FCM token from backend (on logout)
 */
export async function removeTokenFromBackend(fcmToken) {
    try {
        const userRole = await getUserRole();
        // If token not provided, try to get it
        if (!fcmToken) {
            fcmToken = await getFCMToken();
        }

        if (!userRole || !fcmToken) {
            console.log('ℹ️ Local tokens already cleared, skipping server-side token removal');
            return;
        }

        const endpoint = userRole === 'surveyor'
            ? '/surveyor/notifications/remove-token'
            : '/assigner/notifications/remove-token';

        await api.post(endpoint, { fcm_token: fcmToken });
        console.log('✅ FCM token removed from backend');
    } catch (error) {
        console.error('❌ Error removing token:', error);
    }
}

/**
 * Get unread notification count
 */
export async function getUnreadNotificationCount() {
    try {
        const userRole = await getUserRole();
        if (!userRole) return 0;

        const endpoint = userRole === 'surveyor'
            ? '/surveyor/notifications/unread-count'
            : '/assigner/notifications/unread-count';

        const response = await api.get(endpoint);
        return response.success ? response.data.unread_count : 0;
    } catch (error) {
        console.error('Error getting unread count:', error);
        return 0;
    }
}

/**
 * Get in-app notifications
 */
export async function getNotifications(options = {}) {
    try {
        const userRole = await getUserRole();
        if (!userRole) return { notifications: [], unread_count: 0 };

        const endpoint = userRole === 'surveyor'
            ? '/surveyor/notifications/app'
            : '/assigner/notifications/app';

        const response = await api.get(endpoint, options);
        return response.success ? response.data : { notifications: [], unread_count: 0 };
    } catch (error) {
        console.error('Error getting notifications:', error);
        return { notifications: [], unread_count: 0 };
    }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId) {
    try {
        const userRole = await getUserRole();
        if (!userRole) return false;

        const endpoint = userRole === 'surveyor'
            ? `/surveyor/notifications/${notificationId}/read`
            : `/assigner/notifications/${notificationId}/read`;

        const response = await api.put(endpoint);
        return response.success;
    } catch (error) {
        console.error('Error marking notification as read:', error);
        return false;
    }
}

/**
 * Mark all notifications as read
 */
export async function markAllNotificationsAsRead() {
    try {
        const userRole = await getUserRole();
        if (!userRole) return false;

        const endpoint = userRole === 'surveyor'
            ? '/surveyor/notifications/read-all'
            : '/assigner/notifications/read-all';

        const response = await api.put(endpoint);
        return response.success;
    } catch (error) {
        console.error('Error marking all as read:', error);
        return false;
    }
}

/**
 * Add notification response listeners
 */
export function addNotificationListener(onNotificationReceived, onNotificationResponse) {
    const receivedSubscription = Notifications.addNotificationReceivedListener(notification => {
        console.log('📬 Notification received:', notification);
        if (onNotificationReceived) {
            onNotificationReceived(notification);
        }
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
        console.log('👆 Notification tapped:', response);
        if (onNotificationResponse) {
            onNotificationResponse(response);
        }
    });

    return () => {
        receivedSubscription.remove();
        responseSubscription.remove();
    };
}

export default {
    registerForPushNotifications,
    initializeNotifications,
    registerTokenWithBackend,
    removeTokenFromBackend,
    getUnreadNotificationCount,
    getNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    addNotificationListener,
};

