import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, useRef, useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Linking,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    Animated,
    Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors } from '../constants/theme';
import { GOOGLE_MAPS_API_KEY } from '../constants/config';
import { getSurveyDetail, getSurveyorLocation } from '../lib/assignerService';


const { width, height } = Dimensions.get('window');

// Status configurations for the tracking UI
const getTrackingStatus = (status) => {
    switch (status) {
        case 'in_transit':
            return {
                color: '#FF9500',
                bgColor: '#FFF8E1',
                label: 'On the way',
                icon: 'directions-car',
                message: 'Surveyor is heading to the location',
            };
        case 'arrived':
            return {
                color: '#4CAF50',
                bgColor: '#E8F5E9',
                label: 'Arrived',
                icon: 'location-on',
                message: 'Surveyor has arrived at the location',
            };
        case 'visit_completed':
            return {
                color: '#2196F3',
                bgColor: '#E3F2FD',
                label: 'Inspection Complete',
                icon: 'check-circle',
                message: 'Survey inspection completed',
            };
        default:
            return {
                color: '#666',
                bgColor: '#F5F5F5',
                label: 'Tracking',
                icon: 'my-location',
                message: 'Tracking surveyor location',
            };
    }
};

// Custom map style for premium look
const mapStyle = [
    {
        "elementType": "geometry",
        "stylers": [{ "color": "#f5f5f5" }]
    },
    {
        "elementType": "labels.icon",
        "stylers": [{ "visibility": "off" }]
    },
    {
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#616161" }]
    },
    {
        "elementType": "labels.text.stroke",
        "stylers": [{ "color": "#f5f5f5" }]
    },
    {
        "featureType": "poi",
        "elementType": "geometry",
        "stylers": [{ "color": "#eeeeee" }]
    },
    {
        "featureType": "road",
        "elementType": "geometry",
        "stylers": [{ "color": "#ffffff" }]
    },
    {
        "featureType": "road.arterial",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#757575" }]
    },
    {
        "featureType": "road.highway",
        "elementType": "geometry",
        "stylers": [{ "color": "#dadada" }]
    },
    {
        "featureType": "water",
        "elementType": "geometry",
        "stylers": [{ "color": "#c9d7e8" }]
    }
];

// Helper function to get relative time
const getTimeAgo = (timestamp) => {
    if (!timestamp) return '';

    // Parse the date - ensure it's treated as UTC if no timezone specified
    let date;
    if (typeof timestamp === 'string' && !timestamp.includes('Z') && !timestamp.includes('+')) {
        // If no timezone info, assume UTC
        date = new Date(timestamp + 'Z');
    } else {
        date = new Date(timestamp);
    }

    const dateMs = date.getTime();
    if (isNaN(dateMs)) return '';

    const nowMs = Date.now();
    const seconds = Math.floor((nowMs - dateMs) / 1000);

    if (seconds < 0) return 'just now';
    if (seconds < 30) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
};

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

// Fetch directions from Google Directions API
// Fetch directions from Google Directions API
const fetchGoogleDirections = async (origin, destination, apiKey) => {
    try {
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&mode=driving&key=${apiKey}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'OK' && data.routes.length > 0) {
            const route = data.routes[0];
            const leg = route.legs[0];

            // Build the exact road path from per-step geometry so the polyline
            // follows every curve of the road. Fall back to the (simplified)
            // overview polyline only if step geometry is unavailable.
            let coords = [];
            const steps = Array.isArray(leg?.steps) ? leg.steps : [];
            for (const step of steps) {
                if (step.polyline?.points) {
                    coords = coords.concat(decodePolyline(step.polyline.points));
                }
            }
            if (coords.length === 0 && route.overview_polyline?.points) {
                coords = decodePolyline(route.overview_polyline.points);
            }

            // Drop consecutive duplicate points (adjacent steps share endpoints).
            const cleanedCoords = coords.filter((c, i, self) =>
                i === 0 || (c.latitude !== self[i - 1].latitude || c.longitude !== self[i - 1].longitude)
            );

            return {
                coordinates: cleanedCoords,
                distance: leg.distance.value / 1000,
                duration: leg.duration.value / 60,
                distanceText: leg.distance.text,
                durationText: leg.duration.text,
            };
        }
        return null;
    } catch (error) {
        return null;
    }
};

export default function SurveyorTrackingScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { id } = useLocalSearchParams();
    const mapRef = useRef(null);

    const [survey, setSurvey] = useState(null);
    const [surveyorLocation, setSurveyorLocation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [eta, setEta] = useState(null);
    const [distance, setDistance] = useState(null);
    const [showDirections, setShowDirections] = useState(true);
    const [mapError, setMapError] = useState(null);
    const [isRouteReady, setIsRouteReady] = useState(false);
    const [routeCoordinates, setRouteCoordinates] = useState([]);
    const [isMapReady, setIsMapReady] = useState(false);
    const [isSocketConnected, setIsSocketConnected] = useState(false);
    // Android rasterizes custom markers into a single bitmap. Keep tracking ON
    // briefly so the fully-rendered car/flag view is captured, then turn it OFF
    // for performance. Without this the snapshot is taken too early and clips.
    const [tracksMarkerViewChanges, setTracksMarkerViewChanges] = useState(true);
    const fetchedRouteRef = useRef(false);
    const lastRouteLocationRef = useRef(null);

    // Animation values
    const slideAnim = useRef(new Animated.Value(height)).current;
    // Note: the surveyor marker pulse is intentionally static — a native-driven
    // Animated transform inside a rasterized Android map marker corrupts the
    // bitmap capture and clips the marker.

    // Keep re-rasterizing the marker views until the map AND marker have settled,
    // then freeze them for performance. Tying this to isMapReady (not just the
    // first location) avoids freezing a half-laid-out bitmap — freezing too early
    // is what captured a too-small bitmap and clipped the car marker. Re-running
    // on each location update briefly re-captures so it always stays full-size.
    useEffect(() => {
        if (surveyorLocation && isMapReady) {
            setTracksMarkerViewChanges(true);
            const t = setTimeout(() => setTracksMarkerViewChanges(false), 1500);
            return () => clearTimeout(t);
        }
    }, [surveyorLocation, isMapReady]);

    // Slide up animation for bottom card
    useEffect(() => {
        Animated.spring(slideAnim, {
            toValue: 0,
            tension: 50,
            friction: 8,
            useNativeDriver: true,
        }).start();
    }, []);

    // Car bounce animation
    // Car bounce animation - Disabled for stability
    /*
    useEffect(() => {
        const bounce = Animated.loop(
            Animated.sequence([
                Animated.timing(carBounce, {
                    toValue: -5,
                    duration: 500,
                    useNativeDriver: true,
                }),
                Animated.timing(carBounce, {
                    toValue: 0,
                    duration: 500,
                    useNativeDriver: true,
                }),
            ])
        );
        bounce.start();
        return () => bounce.stop();
    }, []);
    */

    // Fetch survey details
    const fetchSurveyDetail = useCallback(async () => {
        try {
            const response = await getSurveyDetail(id);
            const surveyData = response.data;
            setSurvey(surveyData);

            // Check if survey is completed or cancelled - redirect back
            if (['arrived', 'visit_completed', 'report_submitted', 'completed', 'cancelled'].includes(surveyData.status)) {
                if (surveyData.status !== 'in_transit') {
                    // Keep showing but with updated status
                }
            }
        } catch (error) {
            console.error('Error fetching survey:', error);
            Alert.alert('Error', 'Failed to fetch survey details');
        }
    }, [id]);

    // Fetch surveyor's live location
    const fetchSurveyorLocation = useCallback(async () => {
        try {
            const locationData = await getSurveyorLocation(id);
            if (locationData && locationData.latitude && locationData.longitude) {
                const newLocation = {
                    latitude: parseFloat(locationData.latitude),
                    longitude: parseFloat(locationData.longitude),
                    timestamp: locationData.updated_at,
                };
                setSurveyorLocation(newLocation);
            }
        } catch (error) {
            console.error('Error fetching surveyor location:', error);
        }
    }, [id]);

    // Helper function to calculate distance between two points (defined first for use in callbacks)
    const getDistanceBetweenPoints = useCallback((point1, point2) => {
        if (!point1 || !point2) return 0;
        const R = 6371; // Earth's radius in km
        const dLat = (point2.latitude - point1.latitude) * Math.PI / 180;
        const dLon = (point2.longitude - point1.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(point1.latitude * Math.PI / 180) * Math.cos(point2.latitude * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }, []);

    // Initial load
    useEffect(() => {
        const init = async () => {
            setLoading(true);
            await fetchSurveyDetail();
            setLoading(false);
        };
        init();
    }, [fetchSurveyDetail]);

    // Initialize Socket.IO and fallback polling. Depends only on `id` so the 30s
    // fetchSurveyDetail polling (which calls setSurvey) doesn't tear down the socket.
    // Cleanup leaves the room + unsubscribes but does NOT call socketService.disconnect():
    // the socket is a singleton shared with chat/notifications.
    useEffect(() => {
        if (!id) return undefined;

        let unsubLocation = null;
        let unsubStatus = null;
        let locationInterval = null;
        let statusInterval = null;
        let socketServiceInstance = null;
        let unsubConnect = null;
        let isCancelled = false;

        const setupTracking = async () => {
            fetchSurveyorLocation();

            try {
                const socketModule = require('../lib/socket');
                socketServiceInstance = socketModule.default || socketModule.socketService;

                if (!socketServiceInstance) return;

                const socket = await socketServiceInstance.connect();
                if (!socket || isCancelled) return;

                unsubLocation = socketServiceInstance.onLocationUpdate((data) => {
                    if (String(data.surveyId) !== String(id)) return;
                    const newLocation = {
                        latitude: parseFloat(data.latitude),
                        longitude: parseFloat(data.longitude),
                        timestamp: data.timestamp,
                    };
                    setSurveyorLocation(newLocation);

                    if (lastRouteLocationRef.current) {
                        const dist = getDistanceBetweenPoints(lastRouteLocationRef.current, newLocation);
                        if (dist > 0.1) fetchedRouteRef.current = false;
                    }
                });

                unsubStatus = socketServiceInstance.onStatusUpdate((data) => {
                    if (String(data.surveyId) === String(id)) fetchSurveyDetail();
                });

                if (socket.connected) {
                    setIsSocketConnected(true);
                    socketServiceInstance.joinSurveyRoom(id);
                }

                // Re-join the survey room on every transport reconnect.
                const handleConnect = () => {
                    if (isCancelled) return;
                    setIsSocketConnected(true);
                    socketServiceInstance.joinSurveyRoom(id);
                };
                const handleDisconnect = () => {
                    if (!isCancelled) setIsSocketConnected(false);
                };
                socket.on('connect', handleConnect);
                socket.on('disconnect', handleDisconnect);
                unsubConnect = () => {
                    socket.off('connect', handleConnect);
                    socket.off('disconnect', handleDisconnect);
                };
            } catch (err) {
                console.warn('Socket initialization error (will use polling):', err.message);
                setIsSocketConnected(false);
            }

            locationInterval = setInterval(fetchSurveyorLocation, 10000);
            statusInterval = setInterval(fetchSurveyDetail, 30000);
        };

        setupTracking();

        return () => {
            isCancelled = true;

            if (locationInterval) clearInterval(locationInterval);
            if (statusInterval) clearInterval(statusInterval);

            if (unsubLocation) unsubLocation();
            if (unsubStatus) unsubStatus();
            if (unsubConnect) unsubConnect();

            if (socketServiceInstance) {
                try {
                    socketServiceInstance.leaveSurveyRoom(id);
                    // Intentionally NOT calling disconnect() — socket is shared.
                } catch (err) {
                    console.warn('Socket cleanup error:', err.message);
                }
            }
        };
    }, [id, fetchSurveyorLocation, fetchSurveyDetail, getDistanceBetweenPoints]);

    // Fetch route directions from Google Directions API
    useEffect(() => {
        let isMounted = true;
        let timeoutId = null;

        const getDirections = async () => {
            if (!isMapReady || !surveyorLocation || !survey?.latitude || !survey?.longitude || !GOOGLE_MAPS_API_KEY) return;
            if (fetchedRouteRef.current) return;

            const destination = {
                latitude: parseFloat(survey.latitude),
                longitude: parseFloat(survey.longitude)
            };

            const result = await fetchGoogleDirections(surveyorLocation, destination, GOOGLE_MAPS_API_KEY);

            if (result && isMounted) {
                // Delay route rendering slightly to allow map to settle
                timeoutId = setTimeout(() => {
                    if (!isMounted) return;
                    setRouteCoordinates(result.coordinates);
                    setDistance(`${result.distance.toFixed(1)} km`);
                    setEta(`${Math.round(result.duration)} mins`);
                    setIsRouteReady(true);
                    fetchedRouteRef.current = true;
                    lastRouteLocationRef.current = surveyorLocation;
                }, 500);
            } else if (isMounted) {
                setIsRouteReady(false);
            }
        };

        getDirections();

        return () => {
            isMounted = false;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [surveyorLocation, survey, isMapReady]);


    const handleCall = () => {
        if (survey?.surveyor_phone) {
            Linking.openURL(`tel:${survey.surveyor_phone}`);
        }
    };

    // const handleChat = () => {
    //     router.push(`/chat/${id}`);
    // };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <LinearGradient
                    colors={[AppColors.gradientStart, AppColors.gradientEnd]}
                    style={StyleSheet.absoluteFill}
                />
                <ActivityIndicator size="large" color="#FFF" />
                <Text style={styles.loadingText}>Loading tracking...</Text>
            </View>
        );
    }

    if (!survey) {
        return (
            <View style={styles.errorContainer}>
                <MaterialIcons name="error-outline" size={64} color="#CCC" />
                <Text style={styles.errorText}>Survey not found</Text>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Text style={styles.backButtonText}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const trackingStatus = getTrackingStatus(survey.status);
    const destinationCoords = survey.latitude && survey.longitude
        ? { latitude: parseFloat(survey.latitude), longitude: parseFloat(survey.longitude) }
        : null;

    return (
        <View style={styles.container}>
            {/* Map */}
            <MapView
                ref={mapRef}
                style={styles.map}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                customMapStyle={Platform.OS === 'android' ? mapStyle : undefined}
                onMapReady={() => setIsMapReady(true)}
                initialRegion={{
                    latitude: destinationCoords?.latitude || 20.5937,
                    longitude: destinationCoords?.longitude || 78.9629,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
                showsUserLocation={false}
                showsMyLocationButton={false}
                showsCompass={false}
            >
                {/* Route drawn from Google Directions API */}
                {isRouteReady && routeCoordinates.length > 0 && (
                    <Polyline
                        coordinates={routeCoordinates}
                        strokeColor={AppColors.primary}
                        strokeWidth={4}
                    />
                )}

                {/* Fallback Straight Line (shown when route is loading or failed) */}
                {!isRouteReady && surveyorLocation && destinationCoords && (
                    <Polyline
                        coordinates={[
                            { latitude: surveyorLocation.latitude, longitude: surveyorLocation.longitude },
                            { latitude: destinationCoords.latitude, longitude: destinationCoords.longitude }
                        ]}
                        strokeColor={AppColors.primary}
                        strokeWidth={3}
                        lineDashPattern={[10, 5]}
                    />
                )}

                {/* Destination Marker */}
                {destinationCoords && (
                    <Marker coordinate={destinationCoords} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={tracksMarkerViewChanges}>
                        <View style={styles.destinationMarkerContainer}>
                            <View style={[styles.destinationMarker, { backgroundColor: '#FF6B6B' }]}>
                                <MaterialIcons name="flag" size={20} color="#FFF" />
                            </View>
                            <View style={styles.destinationMarkerPin} />
                        </View>
                    </Marker>
                )}

                {/* Surveyor Marker — an EXACT structural clone of the destination
                    flag above (auto-sizing container > circle + pin, bottom anchor).
                    react-native-maps on the New Architecture rasterizes custom markers
                    into a proportionally-scaled bitmap; fixed-size containers make the
                    clip worse, so we copy the flag's auto-sizing layout verbatim. */}
                {surveyorLocation && (
                    <Marker coordinate={surveyorLocation} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={tracksMarkerViewChanges}>
                        <View style={styles.surveyorMarkerContainer}>
                            <View style={[styles.surveyorMarker, { backgroundColor: AppColors.primary }]}>
                                <MaterialIcons name="directions-car" size={20} color="#FFF" />
                            </View>
                            <View style={styles.surveyorMarkerPin} />
                        </View>
                    </Marker>
                )}
            </MapView>

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerBackBtn} onPress={() => router.back()}>
                    <MaterialIcons name="arrow-back" size={24} color="#333" />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <View style={styles.headerTitleRow}>
                        <Text style={styles.headerTitle}>Live Tracking</Text>
                        {isSocketConnected && (
                            <View style={styles.liveIndicator}>
                                <View style={styles.liveDot} />
                                <Text style={styles.liveText}>LIVE</Text>
                            </View>
                        )}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: trackingStatus.bgColor }]}>
                        <View style={[styles.statusDot, { backgroundColor: trackingStatus.color }]} />
                        <Text style={[styles.statusText, { color: trackingStatus.color }]}>{trackingStatus.label}</Text>
                    </View>
                </View>
                <TouchableOpacity style={styles.headerRefreshBtn} onPress={fetchSurveyorLocation}>
                    <MaterialIcons name="refresh" size={22} color="#333" />
                </TouchableOpacity>
            </View>

            {/* ETA Card - Floating */}
            {eta && survey.status === 'in_transit' && (
                <View style={styles.etaCard}>
                    <LinearGradient
                        colors={[AppColors.gradientStart, AppColors.gradientEnd]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.etaCardGradient}
                    >
                        <View style={styles.etaContent}>
                            <MaterialIcons name="schedule" size={20} color="#FFF" />
                            <Text style={styles.etaTime}>{eta}</Text>
                        </View>
                        <View style={styles.etaDivider} />
                        <View style={styles.etaContent}>
                            <MaterialIcons name="straighten" size={20} color="#FFF" />
                            <Text style={styles.etaDistance}>{distance}</Text>
                        </View>
                    </LinearGradient>
                </View>
            )}

            {/* Bottom Card */}
            <Animated.View style={[styles.bottomCard, { paddingBottom: insets.bottom + 16, transform: [{ translateY: slideAnim }] }]}>
                <View style={styles.bottomCardHandle} />

                {/* Status Message */}
                <View style={styles.statusMessageContainer}>
                    <View style={[styles.statusIconContainer, { backgroundColor: trackingStatus.bgColor }]}>
                        <MaterialIcons name={trackingStatus.icon} size={24} color={trackingStatus.color} />
                    </View>
                    <View style={styles.statusMessageText}>
                        <Text style={styles.statusMessageTitle}>{trackingStatus.label}</Text>
                        <Text style={styles.statusMessageSubtitle}>{trackingStatus.message}</Text>
                    </View>
                </View>

                {/* Surveyor Info */}
                <View style={styles.surveyorInfoCard}>
                    <View style={styles.surveyorInfoLeft}>
                        <View style={styles.surveyorAvatarContainer}>
                            <LinearGradient
                                colors={['#9333ea', '#7e22ce']}
                                style={styles.surveyorAvatar}
                            >
                                <Text style={styles.surveyorInitial}>
                                    {(survey.surveyor_name || 'S').charAt(0).toUpperCase()}
                                </Text>
                            </LinearGradient>
                            <View style={styles.onlineIndicator} />
                        </View>
                        <View style={styles.surveyorDetails}>
                            <View style={styles.surveyorNameRow}>
                                <Text style={styles.surveyorName}>{survey.surveyor_name || 'Surveyor'}</Text>
                                <MaterialIcons name="verified" size={16} color="#2196F3" />
                            </View>

                        </View>
                    </View>

                    <View style={styles.actionButtons}>
                        <TouchableOpacity style={styles.actionButton} onPress={handleCall}>
                            <LinearGradient
                                colors={['#4CAF50', '#45a049']}
                                style={styles.actionButtonGradient}
                            >
                                <MaterialIcons name="call" size={20} color="#FFF" />
                            </LinearGradient>
                        </TouchableOpacity>
                        {/* <TouchableOpacity style={styles.actionButton} onPress={handleChat}>
                            <LinearGradient
                                colors={[AppColors.primary, AppColors.gradientEnd]}
                                style={styles.actionButtonGradient}
                            >
                                <MaterialIcons name="chat-bubble" size={20} color="#FFF" />
                            </LinearGradient>
                        </TouchableOpacity> */}
                    </View>
                </View>

                {/* Destination Info */}
                <View style={styles.destinationCard}>
                    <View style={styles.destinationLine}>
                        <View style={styles.destinationDotStart} />
                        <View style={styles.destinationLineBar} />
                        <View style={styles.destinationDotEnd}>
                            <MaterialIcons name="flag" size={12} color="#FF3B30" />
                        </View>
                    </View>
                    <View style={styles.destinationInfo}>
                        <View style={styles.destinationRow}>
                            <Text style={styles.destinationLabel}>Surveyor Location</Text>
                            <Text style={styles.destinationValue} numberOfLines={1}>
                                {surveyorLocation ? (
                                    surveyorLocation.timestamp
                                        ? `Updated ${getTimeAgo(surveyorLocation.timestamp)}`
                                        : 'Live tracking...'
                                ) : 'Waiting for location...'}
                            </Text>
                        </View>
                        <View style={[styles.destinationRow, { marginTop: 20 }]}>
                            <Text style={styles.destinationLabel}>Survey Location</Text>
                            <Text style={styles.destinationValue} numberOfLines={2}>
                                {survey.address || `${survey.city || ''}, ${survey.state || ''}`}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Full Survey Details Link */}
                {/* <TouchableOpacity
                    style={styles.viewDetailsButton}
                    onPress={() => router.push(`/survey-detail/${id}`)}
                >
                    <Text style={styles.viewDetailsText}>View Full Survey Details</Text>
                    <MaterialIcons name="chevron-right" size={20} color={AppColors.primary} />
                </TouchableOpacity> */}
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F5F7',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#FFF',
        fontWeight: '500',
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F5F5F7',
    },
    errorText: {
        fontSize: 16,
        color: '#999',
        marginTop: 12,
    },
    backButton: {
        marginTop: 20,
        paddingHorizontal: 24,
        paddingVertical: 12,
        backgroundColor: AppColors.primary,
        borderRadius: 8,
    },
    backButtonText: {
        color: '#FFF',
        fontWeight: '600',
    },
    map: {
        ...StyleSheet.absoluteFillObject,
    },

    // Header
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: Platform.OS === 'ios' ? 56 : 40,
        paddingHorizontal: 16,
        paddingBottom: 16,
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
    },
    headerBackBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F5F5F5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerCenter: {
        alignItems: 'center',
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#333',
        marginBottom: 4,
    },
    liveIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FF3B30',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        gap: 4,
    },
    liveDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#FFF',
    },
    liveText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#FFF',
        letterSpacing: 0.5,
    },
    headerRefreshBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F5F5F5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
    },

    // ETA Card
    etaCard: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 130 : 110,
        alignSelf: 'center',
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 5,
    },
    etaCardGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    etaContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    etaTime: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFF',
    },
    etaDistance: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFF',
    },
    etaDivider: {
        width: 1,
        height: 24,
        backgroundColor: 'rgba(255,255,255,0.3)',
        marginHorizontal: 16,
    },

    // Markers
    destinationMarkerContainer: {
        alignItems: 'center',
    },
    destinationMarker: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#FF3B30',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    destinationMarkerPin: {
        width: 4,
        height: 12,
        backgroundColor: '#FF3B30',
        marginTop: -2,
    },
    // Exact clone of destinationMarker* above (which renders un-clipped). The car
    // marker MUST auto-size like this — fixed-size containers make Fabric's
    // proportional marker-bitmap clip far worse.
    surveyorMarkerContainer: {
        alignItems: 'center',
    },
    surveyorMarker: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: AppColors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    surveyorMarkerPin: {
        width: 4,
        height: 12,
        backgroundColor: AppColors.primary,
        marginTop: -2,
    },

    // Bottom Card
    bottomCard: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingTop: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 10,
    },
    bottomCardHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#E0E0E0',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 16,
    },

    // Status Message
    statusMessageContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        gap: 12,
    },
    statusIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    statusMessageText: {
        flex: 1,
    },
    statusMessageTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#333',
    },
    statusMessageSubtitle: {
        fontSize: 14,
        color: '#666',
        marginTop: 2,
    },

    // Surveyor Info Card
    surveyorInfoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#F8F9FA',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    surveyorInfoLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    surveyorAvatarContainer: {
        position: 'relative',
    },
    surveyorAvatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        borderWidth: 2,
        borderColor: AppColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    surveyorInitial: {
        fontSize: 20,
        fontWeight: '700',
        color: '#FFF',
    },
    onlineIndicator: {
        position: 'absolute',
        bottom: 2,
        right: 2,
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#4CAF50',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    surveyorDetails: {
        marginLeft: 12,
        flex: 1,
    },
    surveyorNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    surveyorName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    surveyorRatingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        gap: 4,
    },
    surveyorRating: {
        fontSize: 13,
        fontWeight: '600',
        color: '#333',
    },
    surveyorTrips: {
        fontSize: 13,
        color: '#666',
    },
    actionButtons: {
        flexDirection: 'row',
        gap: 10,
    },
    actionButton: {
        borderRadius: 24,
        overflow: 'hidden',
    },
    actionButtonGradient: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Destination Card
    destinationCard: {
        flexDirection: 'row',
        backgroundColor: '#F8F9FA',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    destinationLine: {
        alignItems: 'center',
        marginRight: 12,
    },
    destinationDotStart: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: AppColors.primary,
    },
    destinationLineBar: {
        width: 2,
        flex: 1,
        backgroundColor: '#E0E0E0',
        marginVertical: 4,
    },
    destinationDotEnd: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#FFF0F0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    destinationInfo: {
        flex: 1,
    },
    destinationRow: {},
    destinationLabel: {
        fontSize: 12,
        color: '#999',
        fontWeight: '500',
        marginBottom: 2,
    },
    destinationValue: {
        fontSize: 14,
        color: '#333',
        fontWeight: '500',
    },

    // View Details Button
    viewDetailsButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: AppColors.primary,
        borderRadius: 12,
        gap: 4,
    },
    viewDetailsText: {
        fontSize: 15,
        fontWeight: '600',
        color: AppColors.primary,
    },
});
