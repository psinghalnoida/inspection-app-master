/**
 * useNetworkStatus Hook
 * Monitors network connectivity and triggers sync when back online
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * Hook to monitor network connectivity status
 * @returns {{ isConnected: boolean, isInternetReachable: boolean, connectionType: string }}
 */
export const useNetworkStatus = () => {
    const [networkState, setNetworkState] = useState({
        isConnected: true,
        isInternetReachable: true,
        connectionType: 'unknown',
    });

    useEffect(() => {
        // Subscribe to network state updates
        const unsubscribe = NetInfo.addEventListener(state => {
            setNetworkState({
                isConnected: state.isConnected ?? false,
                isInternetReachable: state.isInternetReachable ?? false,
                connectionType: state.type,
            });
        });

        // Get initial state
        NetInfo.fetch().then(state => {
            setNetworkState({
                isConnected: state.isConnected ?? false,
                isInternetReachable: state.isInternetReachable ?? false,
                connectionType: state.type,
            });
        });

        return () => unsubscribe();
    }, []);

    return networkState;
};

/**
 * Hook to detect when network comes back online and trigger callbacks
 * @param {() => void} onOnline - Callback when transitioning from offline to online
 */
export const useOnlineCallback = (onOnline) => {
    const { isConnected, isInternetReachable } = useNetworkStatus();
    const wasOffline = useRef(false);
    const callbackRef = useRef(onOnline);

    // Update callback ref
    useEffect(() => {
        callbackRef.current = onOnline;
    }, [onOnline]);

    useEffect(() => {
        const isOnline = isConnected && isInternetReachable;

        if (wasOffline.current && isOnline) {
            console.log('📡 Network restored - triggering sync callback');
            callbackRef.current?.();
        }

        wasOffline.current = !isOnline;
    }, [isConnected, isInternetReachable]);
};

/**
 * Check if currently online
 * @returns {Promise<boolean>}
 */
export const isOnline = async () => {
    try {
        const state = await NetInfo.fetch();
        return state.isConnected && state.isInternetReachable;
    } catch (error) {
        console.error('Error checking network status:', error);
        return false;
    }
};

/**
 * Get current network info synchronously from cache
 * Note: This may be stale, prefer async isOnline() for accuracy
 */
let cachedNetworkState = { isConnected: true, isInternetReachable: true };

// Initialize listener to keep cache updated
NetInfo.addEventListener(state => {
    cachedNetworkState = {
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable ?? false,
    };
});

export const isOnlineSync = () => {
    return cachedNetworkState.isConnected && cachedNetworkState.isInternetReachable;
};

export default useNetworkStatus;
