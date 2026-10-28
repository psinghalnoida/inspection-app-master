/**
 * useLocationTracking Hook
 * 
 * This hook manages live location tracking for surveyors during transit.
 * It starts foreground location updates when called and stops when unmounted.
 * Now sends updates via both REST API and Socket.IO for real-time broadcasting.
 * 
 * Usage:
 * const { startTracking, stopTracking, isTracking, lastLocation, error } = useLocationTracking(surveyId);
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import surveyorService from '../lib/surveyorService';
import socketService from '../lib/socket';

const TRACKING_NOTIFICATION_ID = 'location-tracking-active';

// Configuration
const LOCATION_UPDATE_INTERVAL = 10000; // 10 seconds
const LOCATION_DISTANCE_FILTER = 10; // 10 meters minimum movement

export function useLocationTracking(surveyId, autoStart = false) {
    const [isTracking, setIsTracking] = useState(false);
    const [lastLocation, setLastLocation] = useState(null);
    const [error, setError] = useState(null);
    const [permissionStatus, setPermissionStatus] = useState(null);
    const [isSocketConnected, setIsSocketConnected] = useState(false);

    const locationSubscription = useRef(null);
    const intervalRef = useRef(null);
    const isMounted = useRef(true);
    const isTrackingRef = useRef(false); // Ref version for use in callbacks

    // Internal stop function (no dependencies, can be called from sendLocationUpdate)
    const stopTrackingInternal = useCallback(async () => {
        console.log('🛑 Stopping location tracking (internal)...');
        isTrackingRef.current = false;

        if (locationSubscription.current) {
            locationSubscription.current.remove();
            locationSubscription.current = null;
        }

        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        // Leave survey room only. The socket is a shared singleton (chat, notifications,
        // new-request alerts) — disconnecting it here would knock those features offline.
        try {
            if (surveyId && socketService) {
                socketService.leaveSurveyRoom(surveyId);
            }
        } catch (err) {
            console.warn('Socket cleanup error:', err);
        }

        setIsSocketConnected(false);
        setIsTracking(false);

        // Dismiss the persistent tracking notification
        try {
            await Notifications.dismissNotificationAsync(TRACKING_NOTIFICATION_ID);
        } catch (err) {
            console.warn('Failed to dismiss tracking notification:', err);
        }

        console.log('✅ Location tracking stopped (internal)');
    }, [surveyId]);

    // Request location permission
    const requestPermission = useCallback(async () => {
        try {
            const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
            setPermissionStatus(foregroundStatus);

            if (foregroundStatus !== 'granted') {
                setError('Location permission is required for tracking');
                return false;
            }

            // For continuous tracking on Android, we might need background permission
            // But for now, foreground is sufficient as app stays open during transit
            return true;
        } catch (err) {
            console.error('Permission request error:', err);
            setError('Failed to request location permission');
            return false;
        }
    }, []);

    // Initialize Socket.IO connection
    const initializeSocket = useCallback(async () => {
        try {
            const socket = await socketService.connect();
            if (socket) {
                setIsSocketConnected(true);
                socketService.joinSurveyRoom(surveyId);
                console.log('🔌 Socket connected for location tracking');
            }
        } catch (err) {
            console.error('Socket initialization error:', err);
            // Continue without socket - REST API will still work
        }
    }, [surveyId]);

    // Send location update to server (REST API + Socket.IO)
    const sendLocationUpdate = useCallback(async (latitude, longitude) => {
        // Early return if not tracking
        if (!surveyId || !isTrackingRef.current) {
            console.log('⏭️ Skipping location update (not tracking)');
            return;
        }

        try {
            // Send via REST API (primary - ensures persistence)
            await surveyorService.updateLocation(surveyId, latitude, longitude);
            console.log(`📍 REST: Location updated: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);

            // Also send via Socket.IO (for real-time updates to assigners)
            if (socketService && socketService.isSocketConnected()) {
                socketService.sendLocationUpdate(surveyId, latitude, longitude);
                console.log(`🔌 Socket: Location emitted`);
            }

            if (isMounted.current) {
                setLastLocation({ latitude, longitude, timestamp: new Date() });
                setError(null);
            }
        } catch (err) {
            console.error('Failed to send location update:', err);

            // If survey is no longer in transit, stop tracking automatically
            const errorMessage = err.message || '';
            if (errorMessage.includes('not in transit') || err.status === 400) {
                console.log('🛑 Survey no longer in transit, stopping location tracking...');

                // Directly stop tracking by setting ref and clearing resources
                isTrackingRef.current = false;

                if (locationSubscription.current) {
                    locationSubscription.current.remove();
                    locationSubscription.current = null;
                }

                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }

                // Update state
                if (isMounted.current) {
                    setIsTracking(false);
                    setIsSocketConnected(false);
                }

                // Leave the room only — socket is shared with other features.
                try {
                    if (socketService) {
                        socketService.leaveSurveyRoom(surveyId);
                    }
                } catch (socketErr) {
                    console.warn('Socket cleanup error:', socketErr);
                }

                // Dismiss persistent notification
                try {
                    await Notifications.dismissNotificationAsync(TRACKING_NOTIFICATION_ID);
                } catch (notifErr) {
                    console.warn('Failed to dismiss tracking notification:', notifErr);
                }

                console.log('✅ Location tracking stopped (auto-stopped due to status change)');
            }
        }
    }, [surveyId]);

    // Start location tracking
    const startTracking = useCallback(async () => {
        if (isTracking || isTrackingRef.current) {
            console.log('⚠️ Already tracking');
            return;
        }

        const hasPermission = await requestPermission();
        if (!hasPermission) {
            return;
        }

        try {
            console.log('🚀 Starting location tracking...');
            setIsTracking(true);
            isTrackingRef.current = true;
            setError(null);

            // Show persistent notification required by Google Play monitoring policy
            try {
                await Notifications.scheduleNotificationAsync({
                    identifier: TRACKING_NOTIFICATION_ID,
                    content: {
                        title: 'Location tracking active',
                        body: 'Your location is being shared with the assigned officer for this survey. Tracking stops when inspection begins.',
                        android: {
                            ongoing: true,
                            sticky: true,
                            color: '#FF9500',
                            smallIcon: 'ic_notification',
                        },
                    },
                    trigger: null,
                });
            } catch (err) {
                console.warn('Failed to show tracking notification:', err);
            }

            // Initialize Socket.IO connection
            await initializeSocket();

            // Get initial location immediately
            const initialLocation = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            });

            const { latitude, longitude } = initialLocation.coords;
            await sendLocationUpdate(latitude, longitude);

            // Set up location watching for real-time updates
            locationSubscription.current = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: LOCATION_UPDATE_INTERVAL,
                    distanceInterval: LOCATION_DISTANCE_FILTER,
                },
                (location) => {
                    if (isTrackingRef.current) {
                        const { latitude, longitude } = location.coords;
                        sendLocationUpdate(latitude, longitude);
                    }
                }
            );

            // Also set up a backup interval in case watchPositionAsync doesn't fire
            // This ensures we send updates at least every N seconds
            intervalRef.current = setInterval(async () => {
                if (!isTrackingRef.current) {
                    clearInterval(intervalRef.current);
                    return;
                }
                try {
                    const location = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    });
                    await sendLocationUpdate(location.coords.latitude, location.coords.longitude);
                } catch (err) {
                    console.warn('Interval location fetch failed:', err);
                }
            }, LOCATION_UPDATE_INTERVAL);

            console.log('✅ Location tracking started (REST + Socket.IO)');
        } catch (err) {
            console.error('Failed to start tracking:', err);
            setIsTracking(false);
            isTrackingRef.current = false;
            setError('Failed to start location tracking');
        }
    }, [isTracking, requestPermission, sendLocationUpdate, initializeSocket]);

    // Stop location tracking (public function)
    const stopTracking = useCallback(() => {
        stopTrackingInternal();
    }, [stopTrackingInternal]);

    // Auto-start if requested
    useEffect(() => {
        if (autoStart && surveyId) {
            startTracking();
        }
    }, [autoStart, surveyId]);

    // Cleanup on unmount
    useEffect(() => {
        isMounted.current = true;

        return () => {
            isMounted.current = false;
            stopTracking();
        };
    }, [stopTracking]);

    return {
        startTracking,
        stopTracking,
        isTracking,
        lastLocation,
        error,
        permissionStatus,
        isSocketConnected,
    };
}

export default useLocationTracking;

