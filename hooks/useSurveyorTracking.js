/**
 * useSurveyorTracking Hook
 * 
 * This hook manages real-time tracking of surveyor location for assigners.
 * It connects to Socket.IO for live updates and falls back to REST API polling.
 * 
 * Usage:
 * const { surveyorLocation, isConnected, eta, distance, status, error } = useSurveyorTracking(surveyId);
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import socketService from '../lib/socket';
import { getSurveyorLocation } from '../lib/assignerService';
import { GOOGLE_MAPS_API_KEY } from '../constants/config';

// Configuration
const POLLING_INTERVAL = 30000; // 30 seconds fallback polling
const ROUTE_REFRESH_DISTANCE = 0.1; // 100 meters

// Decode Google Polyline encoded string
const decodePolyline = (encoded) => {
    if (!encoded) return [];
    const poly = [];
    let index = 0, lat = 0, lng = 0;

    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        poly.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
    return poly;
};

// Calculate distance between two points using Haversine formula
const getDistanceBetweenPoints = (point1, point2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (point2.latitude - point1.latitude) * Math.PI / 180;
    const dLon = (point2.longitude - point1.longitude) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(point1.latitude * Math.PI / 180) * Math.cos(point2.latitude * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// Fetch directions from Google Directions API
const fetchGoogleDirections = async (origin, destination) => {
    try {
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'OK' && data.routes.length > 0) {
            const route = data.routes[0];
            const leg = route.legs[0];
            const polyline = route.overview_polyline.points;

            const coords = decodePolyline(polyline);
            // Downsample coordinates to prevent performance issues
            const simplifiedCoords = coords.filter((_, i) => i % 3 === 0 || i === coords.length - 1);

            return {
                coordinates: simplifiedCoords,
                distance: leg.distance.value / 1000, // km
                duration: leg.duration.value / 60, // minutes
                distanceText: leg.distance.text,
                durationText: leg.duration.text,
            };
        }
        return null;
    } catch (error) {
        console.error('Error fetching directions:', error);
        return null;
    }
};

export function useSurveyorTracking(surveyId, destination = null) {
    const [surveyorLocation, setSurveyorLocation] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [route, setRoute] = useState(null);
    const [eta, setEta] = useState(null);
    const [distance, setDistance] = useState(null);
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);

    const pollingIntervalRef = useRef(null);
    const isMounted = useRef(true);
    const lastRouteLocationRef = useRef(null);
    const cleanupListenersRef = useRef([]);
    // Hold latest destination in a ref so callbacks stay stable across renders.
    // Parents typically pass freshly-constructed { latitude, longitude } objects every
    // render; depending on them directly would tear down the socket on every re-render.
    const destinationRef = useRef(destination);
    useEffect(() => {
        destinationRef.current = destination;
    }, [destination?.latitude, destination?.longitude]);

    // Fetch location via REST API (fallback)
    const fetchLocation = useCallback(async () => {
        if (!surveyId) return;

        try {
            const locationData = await getSurveyorLocation(surveyId);
            if (locationData && locationData.latitude && locationData.longitude) {
                const newLocation = {
                    latitude: parseFloat(locationData.latitude),
                    longitude: parseFloat(locationData.longitude),
                    timestamp: locationData.updated_at,
                };

                if (isMounted.current) {
                    setSurveyorLocation(newLocation);
                }
            }
        } catch (err) {
            console.error('Error fetching surveyor location:', err);
            if (isMounted.current) {
                setError('Failed to fetch location');
            }
        }
    }, [surveyId]);

    // Reads destination from a ref so the callback is stable.
    const updateRoute = useCallback(async (location) => {
        const dest = destinationRef.current;
        if (!dest || !location) return;

        if (lastRouteLocationRef.current) {
            const movedDistance = getDistanceBetweenPoints(lastRouteLocationRef.current, location);
            if (movedDistance < ROUTE_REFRESH_DISTANCE) return;
        }

        const routeData = await fetchGoogleDirections(location, dest);
        if (routeData && isMounted.current) {
            setRoute(routeData.coordinates);
            setEta(`${Math.round(routeData.duration)} mins`);
            setDistance(`${routeData.distance.toFixed(1)} km`);
            lastRouteLocationRef.current = location;
        }
    }, []);

    // Tracking lifecycle — only depends on stable refs so the socket persists across renders.
    // Cleanup leaves the room + unsubscribes but does NOT disconnect the singleton (shared
    // with chat/notifications).
    useEffect(() => {
        if (!surveyId) return undefined;

        isMounted.current = true;
        let unsubConnect = null;

        (async () => {
            fetchLocation();

            const socket = await socketService.connect();
            if (!socket || !isMounted.current) return;

            const unsubLocation = socketService.onLocationUpdate((data) => {
                if (data.surveyId === surveyId || data.surveyId === parseInt(surveyId)) {
                    const newLocation = {
                        latitude: parseFloat(data.latitude),
                        longitude: parseFloat(data.longitude),
                        timestamp: data.timestamp,
                    };
                    if (isMounted.current) {
                        setSurveyorLocation(newLocation);
                        updateRoute(newLocation);
                    }
                }
            });
            cleanupListenersRef.current.push(unsubLocation);

            const unsubStatus = socketService.onStatusUpdate((data) => {
                if (data.surveyId === surveyId || data.surveyId === parseInt(surveyId)) {
                    if (isMounted.current) setStatus(data.status);
                }
            });
            cleanupListenersRef.current.push(unsubStatus);

            if (socket.connected) {
                setIsConnected(true);
                socketService.joinSurveyRoom(surveyId);
            }

            // Socket.IO rooms don't survive transport reconnects — re-join on every connect.
            const handleConnect = () => {
                if (!isMounted.current) return;
                setIsConnected(true);
                socketService.joinSurveyRoom(surveyId);
            };
            const handleDisconnect = () => {
                if (isMounted.current) setIsConnected(false);
            };
            socket.on('connect', handleConnect);
            socket.on('disconnect', handleDisconnect);
            unsubConnect = () => {
                socket.off('connect', handleConnect);
                socket.off('disconnect', handleDisconnect);
            };
        })();

        pollingIntervalRef.current = setInterval(fetchLocation, POLLING_INTERVAL);

        return () => {
            isMounted.current = false;

            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }

            cleanupListenersRef.current.forEach(cleanup => cleanup && cleanup());
            cleanupListenersRef.current = [];

            if (unsubConnect) unsubConnect();

            socketService.leaveSurveyRoom(surveyId);
            // Intentionally NOT calling socketService.disconnect() — the socket is shared.
        };
    }, [surveyId, fetchLocation, updateRoute]);

    // Re-route when destination becomes available or its coordinates change.
    useEffect(() => {
        if (surveyorLocation && destination) {
            updateRoute(surveyorLocation);
        }
    }, [surveyorLocation, destination?.latitude, destination?.longitude, updateRoute]);

    return {
        surveyorLocation,
        isConnected,
        route,
        eta,
        distance,
        status,
        error,
        refetchLocation: fetchLocation,
    };
}

export default useSurveyorTracking;
