import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActionSheetIOS,
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Linking,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GOOGLE_MAPS_API_KEY } from '../constants/config';
import { AppColors } from '../constants/theme';
import { useLocationTracking } from '../hooks/useLocationTracking';
import api from '../lib/api';

const { width, height } = Dimensions.get('window');

// Status configurations for the tracking UI
const getTrackingStatus = (status) => {
    switch (status) {
        case 'in_transit':
            return {
                color: '#FF9500',
                bgColor: '#FFF8E1',
                label: 'In Transit',
                icon: 'directions-car',
                message: 'Navigate to the survey location',
            };
        case 'arrived':
            return {
                color: '#4CAF50',
                bgColor: '#E8F5E9',
                label: 'Arrived',
                icon: 'location-on',
                message: 'You have arrived at the location',
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
                message: 'Your live location',
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
const fetchGoogleDirections = async (origin, destination, apiKey) => {
    try {
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&mode=driving&key=${apiKey}`;
        console.log('🗺️ Fetching directions...');

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
                i === 0 || c.latitude !== self[i - 1].latitude || c.longitude !== self[i - 1].longitude
            );

            console.log('✅ Route fetched:', leg.distance.text, leg.duration.text);

            return {
                coordinates: cleanedCoords,
                distance: leg.distance.value / 1000,
                duration: leg.duration.value / 60,
                distanceText: leg.distance.text,
                durationText: leg.duration.text,
            };
        }
        console.log('❌ Directions API returned status:', data.status, data.error_message || '');
        return null;
    } catch (error) {
        console.error('❌ Error fetching directions:', error);
        return null;
    }
};

export default function SurveyorSelfTrackingScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { id } = useLocalSearchParams();
    const mapRef = useRef(null);

    const [survey, setSurvey] = useState(null);
    const [loading, setLoading] = useState(true);
    const [eta, setEta] = useState(null);
    const [distance, setDistance] = useState(null);
    const [isRouteReady, setIsRouteReady] = useState(false);
    const [routeCoordinates, setRouteCoordinates] = useState([]);
    const [actionLoading, setActionLoading] = useState(false);
    const [showDisclosure, setShowDisclosure] = useState(true);
    const fetchedRouteRef = useRef(false);
    const lastRouteLocationRef = useRef(null);

    // Use the location tracking hook — autoStart is false; tracking begins after user consents
    const {
        startTracking,
        stopTracking,
        isTracking,
        lastLocation,
        error: locationError,
        isSocketConnected,
    } = useLocationTracking(id, false);

    const handleConsentAndStart = useCallback(() => {
        setShowDisclosure(false);
        startTracking();
    }, [startTracking]);

    // Animation values
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(height)).current;

    // Pulse animation for the current location marker
    useEffect(() => {
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.5,
                    duration: 1000,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                }),
            ])
        );
        pulse.start();
        return () => pulse.stop();
    }, []);

    // Slide up animation for bottom card
    useEffect(() => {
        Animated.spring(slideAnim, {
            toValue: 0,
            tension: 50,
            friction: 8,
            useNativeDriver: true,
        }).start();
    }, []);

    // Fetch survey details
    const fetchSurveyDetail = useCallback(async () => {
        try {
            const response = await api.get(`/surveyor/surveys/${id}`);
            if (response.success) {
                setSurvey(response.data);
            }
        } catch (error) {
            console.error('Error fetching survey:', error);
            Alert.alert('Error', 'Failed to fetch survey details');
        }
    }, [id]);

    // Initial load
    useEffect(() => {
        const init = async () => {
            setLoading(true);
            await fetchSurveyDetail();
            setLoading(false);
        };
        init();
    }, [fetchSurveyDetail]);

    // Helper function to calculate distance between two points
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

    // Fetch route directions from Google Directions API
    useEffect(() => {
        const getDirections = async () => {
            if (!lastLocation || !survey?.latitude || !survey?.longitude || !GOOGLE_MAPS_API_KEY) return;
            if (fetchedRouteRef.current) {
                // Check if location changed significantly (> 100m) to refresh route
                if (lastRouteLocationRef.current) {
                    const dist = getDistanceBetweenPoints(lastRouteLocationRef.current, lastLocation);
                    if (dist < 0.1) return;
                }
            }

            const destination = {
                latitude: parseFloat(survey.latitude),
                longitude: parseFloat(survey.longitude)
            };

            const result = await fetchGoogleDirections(lastLocation, destination, GOOGLE_MAPS_API_KEY);

            if (result) {
                setRouteCoordinates(result.coordinates);
                setDistance(`${result.distance.toFixed(1)} km`);
                setEta(`${Math.round(result.duration)} mins`);
                setIsRouteReady(true);
                fetchedRouteRef.current = true;
                lastRouteLocationRef.current = lastLocation;
            } else {
                setIsRouteReady(false);
            }
        };

        getDirections();
    }, [lastLocation, survey, getDistanceBetweenPoints]);

    // Fit map to show both markers
    const fitMapToMarkers = useCallback(() => {
        if (!mapRef.current || !lastLocation || !survey?.latitude || !survey?.longitude) return;

        const destination = {
            latitude: parseFloat(survey.latitude),
            longitude: parseFloat(survey.longitude),
        };

        mapRef.current.fitToCoordinates(
            [lastLocation, destination],
            {
                edgePadding: { top: 150, right: 50, bottom: 350, left: 50 },
                animated: true,
            }
        );
    }, [lastLocation, survey]);

    // Fit map when both locations are available
    useEffect(() => {
        if (lastLocation && survey?.latitude) {
            setTimeout(fitMapToMarkers, 500);
        }
    }, [lastLocation, survey, fitMapToMarkers]);

    // Center on current location
    const centerOnCurrentLocation = () => {
        if (mapRef.current && lastLocation) {
            mapRef.current.animateToRegion({
                latitude: lastLocation.latitude,
                longitude: lastLocation.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
            }, 500);
        }
    };

    // Open navigation in external app
    const openNavigation = () => {
        if (!survey?.latitude || !survey?.longitude) {
            Alert.alert('Error', 'Destination coordinates not available');
            return;
        }

        const destination = `${survey.latitude},${survey.longitude}`;
        const label = encodeURIComponent(survey.address || 'Survey Location');

        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: ['Cancel', 'Apple Maps', 'Google Maps'],
                    cancelButtonIndex: 0,
                },
                (buttonIndex) => {
                    if (buttonIndex === 1) {
                        Linking.openURL(`maps:?daddr=${destination}&q=${label}`);
                    } else if (buttonIndex === 2) {
                        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination}`);
                    }
                }
            );
        } else {
            Alert.alert(
                'Open Navigation',
                'Choose your preferred navigation app',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Google Maps',
                        onPress: () => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination}`),
                    },
                ]
            );
        }
    };

    // Mark as arrived
    const handleMarkArrived = async () => {
        Alert.alert(
            'Confirm Arrival',
            'Are you sure you have arrived at the survey location?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Yes, I\'ve Arrived',
                    onPress: async () => {
                        setActionLoading(true);
                        try {
                            const response = await api.post(`/surveyor/surveys/${id}/arrive`);
                            if (response.success) {
                                stopTracking();
                                Alert.alert('Success', 'You have been marked as arrived!');
                                router.back();
                            }
                        } catch (error) {
                            Alert.alert('Error', error.message || 'Failed to mark arrival');
                        } finally {
                            setActionLoading(false);
                        }
                    },
                },
            ]
        );
    };

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
                initialRegion={{
                    latitude: lastLocation?.latitude || destinationCoords?.latitude || 20.5937,
                    longitude: lastLocation?.longitude || destinationCoords?.longitude || 78.9629,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
                showsUserLocation={false}
                showsMyLocationButton={false}
                showsCompass={false}
            >
                {/* Route Polyline */}
                {isRouteReady && routeCoordinates.length > 0 && (
                    <Polyline
                        coordinates={routeCoordinates}
                        strokeColor={AppColors.primary}
                        strokeWidth={5}
                    />
                )}

                {/* Fallback Straight Line (shown when route is loading or failed) */}
                {!isRouteReady && lastLocation && destinationCoords && (
                    <Polyline
                        coordinates={[
                            { latitude: lastLocation.latitude, longitude: lastLocation.longitude },
                            { latitude: destinationCoords.latitude, longitude: destinationCoords.longitude }
                        ]}
                        strokeColor={AppColors.primary}
                        strokeWidth={3}
                        lineDashPattern={[10, 5]}
                    />
                )}

                {/* Destination Marker */}
                {destinationCoords && (
                    <Marker coordinate={destinationCoords} anchor={{ x: 0.5, y: 1 }}>
                        <View style={styles.destinationMarkerContainer}>
                            <View style={[styles.destinationMarker, { backgroundColor: '#FF6B6B' }]}>
                                <MaterialIcons name="flag" size={20} color="#FFF" />
                            </View>
                            <View style={styles.destinationMarkerPin} />
                        </View>
                    </Marker>
                )}

                {/* Current Location Marker (You) */}
                {lastLocation && (
                    <Marker coordinate={lastLocation} anchor={{ x: 0.5, y: 0.5 }}>
                        <View style={styles.currentLocationMarkerContainer}>
                            <Animated.View style={[styles.currentLocationPulse, { transform: [{ scale: pulseAnim }] }]} />
                            <View style={styles.currentLocationMarker}>
                                <View style={styles.currentLocationMarkerInner} />
                            </View>
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
                        {isTracking && (
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
                <TouchableOpacity style={styles.headerRefreshBtn} onPress={fitMapToMarkers}>
                    <MaterialIcons name="fullscreen" size={22} color="#333" />
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

            {/* Floating Action Buttons */}
            <View style={styles.fabContainer}>
                <TouchableOpacity style={styles.fabButton} onPress={centerOnCurrentLocation}>
                    <MaterialIcons name="my-location" size={24} color={AppColors.primary} />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.fabButton, styles.fabButtonPrimary]} onPress={openNavigation}>
                    <MaterialIcons name="navigation" size={24} color="#FFF" />
                </TouchableOpacity>
            </View>

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
                            <Text style={styles.destinationLabel}>Your Location</Text>
                            <Text style={styles.destinationValue} numberOfLines={1}>
                                {lastLocation ? 'GPS Tracking Active' : 'Waiting for location...'}
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

                {/* Action Buttons */}
                <View style={styles.actionButtonsRow}>
                    {survey.status === 'in_transit' && (
                        <TouchableOpacity
                            style={styles.arriveButton}
                            onPress={() => {
                                // Stop location tracking before navigating to inspection
                                stopTracking();
                                router.push(`/surveyor-execution/${id}`);
                            }}
                        >
                            <LinearGradient
                                colors={['#4CAF50', '#45a049']}
                                style={styles.arriveButtonGradient}
                            >
                                <MaterialIcons name="play-arrow" size={24} color="#FFF" />
                                <Text style={styles.arriveButtonText}>Start Inspection</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Survey Reference */}
                <View style={styles.referenceRow}>
                    <Text style={styles.referenceLabel}>Case Ref:</Text>
                    <Text style={styles.referenceValue}>{survey.case_reference || `#${survey.id}`}</Text>
                </View>
            </Animated.View>

            {/* Location Error Banner */}
            {locationError && (
                <View style={styles.errorBanner}>
                    <MaterialIcons name="error" size={20} color="#FFF" />
                    <Text style={styles.errorBannerText}>{locationError}</Text>
                </View>
            )}

            {/* Location Tracking Disclosure — required by Google Play monitoring policy */}
            <Modal
                visible={showDisclosure}
                transparent
                animationType="fade"
                onRequestClose={() => {}}
            >
                <View style={styles.disclosureOverlay}>
                    <View style={styles.disclosureCard}>
                        <MaterialIcons name="location-on" size={40} color={AppColors.primary} />
                        <Text style={styles.disclosureTitle}>Location Sharing</Text>
                        <Text style={styles.disclosureBody}>
                            Your live location will be shared with the assigned officer while you are in transit to the survey site.{'\n\n'}
                            Tracking starts when you tap Allow and stops automatically once you begin the inspection.{'\n\n'}
                            A notification will remain visible on your device while tracking is active.
                        </Text>
                        <TouchableOpacity style={styles.disclosureAllowBtn} onPress={handleConsentAndStart}>
                            <Text style={styles.disclosureAllowText}>Allow &amp; Start Transit</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
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
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
    },
    headerRefreshBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F5F5F5',
        justifyContent: 'center',
        alignItems: 'center',
    },

    // ETA Card
    etaCard: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 130 : 110,
        left: 20,
        right: 20,
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 6,
    },
    etaCardGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingHorizontal: 20,
    },
    etaContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    etaTime: {
        fontSize: 18,
        fontWeight: '700',
        color: '#FFF',
    },
    etaDivider: {
        width: 1,
        height: 24,
        backgroundColor: 'rgba(255,255,255,0.3)',
        marginHorizontal: 20,
    },
    etaDistance: {
        fontSize: 18,
        fontWeight: '700',
        color: '#FFF',
    },

    // FAB
    fabContainer: {
        position: 'absolute',
        right: 16,
        bottom: 340,
        gap: 12,
    },
    fabButton: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#FFF',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 4,
    },
    fabButtonPrimary: {
        backgroundColor: AppColors.primary,
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
        paddingTop: 12,
        paddingHorizontal: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 8,
    },
    bottomCardHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#DDD',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 16,
    },

    // Status Message
    statusMessageContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
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
        fontSize: 16,
        fontWeight: '700',
        color: '#333',
    },
    statusMessageSubtitle: {
        fontSize: 13,
        color: '#666',
        marginTop: 2,
    },

    // Destination Card
    destinationCard: {
        flexDirection: 'row',
        backgroundColor: '#F9F9F9',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    destinationLine: {
        width: 20,
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
        backgroundColor: '#DDD',
        marginVertical: 4,
    },
    destinationDotEnd: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#FFF',
        borderWidth: 2,
        borderColor: '#FF3B30',
        justifyContent: 'center',
        alignItems: 'center',
    },
    destinationInfo: {
        flex: 1,
    },
    destinationRow: {},
    destinationLabel: {
        fontSize: 11,
        color: '#999',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    destinationValue: {
        fontSize: 14,
        color: '#333',
        fontWeight: '500',
        marginTop: 4,
    },

    // Action Buttons
    actionButtonsRow: {
        marginBottom: 12,
    },
    arriveButton: {
        borderRadius: 16,
        overflow: 'hidden',
    },
    arriveButtonGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        gap: 8,
    },
    arriveButtonText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFF',
    },

    // Reference
    referenceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
    },
    referenceLabel: {
        fontSize: 12,
        color: '#999',
    },
    referenceValue: {
        fontSize: 12,
        color: '#666',
        fontWeight: '600',
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
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 4,
    },
    destinationMarkerPin: {
        width: 4,
        height: 12,
        backgroundColor: '#FF6B6B',
        marginTop: -2,
    },
    currentLocationMarkerContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 50,
        height: 50,
    },
    currentLocationPulse: {
        position: 'absolute',
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(172, 154, 253, 0.3)',
    },
    currentLocationMarker: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#FFF',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 4,
    },
    currentLocationMarkerInner: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: AppColors.primary,
    },

    // Error Banner
    errorBanner: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 180 : 160,
        left: 20,
        right: 20,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FF3B30',
        borderRadius: 10,
        padding: 12,
        gap: 8,
    },
    errorBannerText: {
        flex: 1,
        fontSize: 13,
        color: '#FFF',
        fontWeight: '500',
    },

    // Location tracking disclosure modal
    disclosureOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    disclosureCard: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 28,
        alignItems: 'center',
        width: '100%',
        maxWidth: 380,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
    },
    disclosureTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1A1A1A',
        marginTop: 12,
        marginBottom: 16,
    },
    disclosureBody: {
        fontSize: 14,
        color: '#555',
        lineHeight: 22,
        textAlign: 'center',
        marginBottom: 24,
    },
    disclosureAllowBtn: {
        backgroundColor: AppColors.primary,
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 32,
        width: '100%',
        alignItems: 'center',
    },
    disclosureAllowText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '700',
    },
});
