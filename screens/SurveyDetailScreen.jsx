import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ResizeMode, Video } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Linking,
    Modal,
    Platform,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useAuth } from '../app/_layout';
import ChatModal from '../components/ChatModal';
import { AppColors } from '../constants/theme';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { escalateSurvey, getSurveyDetail, initiatePayment, markSatisfied, verifyPayment, getBroadcastStatus, applyCoupon, getSessionNotes as getAssignerSessionNotes, getSurveyBill, payBalance } from '../lib/assignerService';
import surveyorService from '../lib/surveyorService';
import { getAccessToken } from '../lib/storage';

// API_BASE_URL is still needed for the authenticated reports endpoint below —
// that is an API route, not an upload, so it keeps the prefix.
import { API_BASE_URL, getMediaUrl } from '../constants/config';

const blurhash = '|rF?hV%2WCj[ayj[a|j[az_NaeWBj@ayfRayfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQfQ';

const { width } = Dimensions.get('window');

const getStatusConfig = (status) => {
    switch (status) {
        case 'pending':
        case 'pending_assignment':
        case 'pending_payment':
            return { color: '#FF6B6B', bgColor: '#FFF0F0', label: 'Pending Location' };
        case 'assigned':
            return { color: '#FF9500', bgColor: '#FFF8E1', label: 'Surveyor Assigned' };
        case 'location_detected':
            return { color: '#2196F3', bgColor: '#E3F2FD', label: 'Broadcasting...' };
        case 'location_shared':
            return { color: '#2196F3', bgColor: '#E3F2FD', label: 'Location Shared' };
        case 'in_progress':
        case 'in_transit':
            return { color: '#4CAF50', bgColor: '#E8F5E9', label: 'In Transit' };
        case 'reached':
            return { color: '#4CAF50', bgColor: '#E8F5E9', label: 'Reached' };
        case 'photos_uploaded':
            return { color: '#03A9F4', bgColor: '#E1F5FE', label: 'Photos Uploaded' };
        case 'report_submitted':
            return { color: '#03A9F4', bgColor: '#E1F5FE', label: 'Report Submitted' };
        case 'completed':
        case 'finished':
            return { color: '#9C27B0', bgColor: '#F3E5F5', label: 'Completed' };
        case 'cancelled':
            return { color: '#757575', bgColor: '#F5F5F5', label: 'Cancelled' };
        case 'disputed':
            return { color: '#FF9800', bgColor: '#FFF3E0', label: 'Disputed' };
        case 'not_resolved':
            return { color: '#D32F2F', bgColor: '#FFEBEE', label: 'Not Resolved' };
        case 'resolved':
            return { color: '#388E3C', bgColor: '#E8F5E9', label: 'Resolved' };
        default:
            return { color: '#666', bgColor: '#F5F5F5', label: status?.replace(/_/g, ' ') || 'Unknown' };
    }
};

// Helper to parse dates with proper timezone handling
const parseDate = (dateString) => {
    if (!dateString) return null;
    return new Date(dateString);
};

// Helper to parse UTC timestamps correctly as local time
const parseDateAsLocal = (dateString) => {
    if (!dateString) return null;
    // Parse UTC timestamp - JavaScript automatically converts to local time
    return new Date(dateString);
};

const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = parseDate(dateString);
    if (!date || isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

// Invoice figures always carry 2 decimals (v2 §3 money UI rules).
const formatINR = (amount) =>
    `₹${parseFloat(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// v2 §4.4 — reports left the public static mount; `/uploads/reports/...` now 403s.
// They are served by GET /api/v1/files/reports/:surveyId/:filename, which requires
// the Authorization header. PHOTO and DOCUMENT urls are unchanged.
const buildReportUrl = (surveyId, fileUrl) =>
    `${API_BASE_URL}/files/reports/${surveyId}/${encodeURIComponent(String(fileUrl || '').split('/').filter(Boolean).pop() || '')}`;

// That endpoint answers 402 REPORT_PAYMENT_REQUIRED (unpaid invoice) or 403 with a
// JSON body. Read the server's own sentence instead of inventing one.
const fetchReportErrorMessage = async (url, headers) => {
    try {
        const res = await fetch(url, { headers });
        if (res.ok) return null;
        const body = await res.json();
        return body?.message || null;
    } catch {
        return null;
    }
};

const formatLocationMethod = (method) => {
    if (!method) return 'N/A';
    const methods = {
        'manual_coordinates': 'GPS Coordinates',
        'pincode_entry': 'Manual Entry',
        'sms_link': 'SMS Link',
        'gps_auto': 'GPS Auto',
    };
    return methods[method] || method.replace(/_/g, ' ');
};

const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const deg2rad = (deg) => deg * (Math.PI / 180);
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
};

export default function SurveyDetailScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { id } = useLocalSearchParams();
    const { userRole } = useAuth();
    const isSurveyor = userRole === 'surveyor';
    console.log('SurveyDetailScreen - userRole:', userRole, 'isSurveyor:', isSurveyor);
    const [survey, setSurvey] = useState(null);
    const [sessionNotes, setSessionNotes] = useState([]);
    // v2 §3 — { bill, billing_state, message }; assigner only.
    const [billing, setBilling] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [payingBalance, setPayingBalance] = useState(false);
    const [photoTab, setPhotoTab] = useState('All');
    const [previewDoc, setPreviewDoc] = useState(null);

    const [reportModalVisible, setReportModalVisible] = useState(false);
    const [reportNotes, setReportNotes] = useState('');
    const [reportFile, setReportFile] = useState(null);

    // Photo Gallery Modal State
    const [photoGalleryVisible, setPhotoGalleryVisible] = useState(false);
    const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
    const [photoTypeFilter, setPhotoTypeFilter] = useState('all');
    const [isDownloading, setIsDownloading] = useState(false);
    const [currentDistance, setCurrentDistance] = useState(null);

    // Location tracking for surveyors in transit
    const { startTracking, stopTracking, isTracking, lastLocation } = useLocationTracking(id);
    const hasStartedTracking = useRef(false);

    // A locked report points at the Invoice card further up this same screen
    // rather than repeating its figures (v2 §4.4).
    const scrollRef = useRef(null);
    const invoiceOffsetRef = useRef(0);

    // Chat State
    const [chatVisible, setChatVisible] = useState(false);

    // Broadcast Status State (for assigner during active broadcast)
    const [broadcastStatus, setBroadcastStatus] = useState(null);
    const [secondsLeft, setSecondsLeft] = useState(null);

    // Coupon State
    const [couponCode, setCouponCode] = useState('');
    const [couponApplied, setCouponApplied] = useState(false);
    const [couponLoading, setCouponLoading] = useState(false);
    const [couponError, setCouponError] = useState('');
    const [discountAmount, setDiscountAmount] = useState(0);
    const [footerHeight, setFooterHeight] = useState(0);


    // Timeout Calculation — 7 days from when the survey entered in_transit
    const isTimedOut = useMemo(() => {
        if (!survey?.in_transit_at) return false;
        const blockedStatuses = ['finished', 'completed', 'cancelled', 'disputed', 'not_resolved', 'escalated'];
        if (blockedStatuses.includes(survey.status)) return false;

        const startTime = new Date(survey.in_transit_at);
        const diffDays = (new Date() - startTime) / (1000 * 60 * 60 * 24);
        return diffDays >= 7;
    }, [survey]);

    const handleEscalateToAdmin = async () => {
        setActionLoading(true);
        try {
            await escalateSurvey(id);
            Alert.alert('Escalated', 'Survey has been escalated to admin.');
            fetchSurveyDetail();
        } catch (error) {
            console.error(error);
            Alert.alert('Error', error.message || 'Failed to escalate');
        } finally {
            setActionLoading(false);
        }
    };

    // Handle Apply Coupon
    const handleApplyCoupon = async () => {
        if (!couponCode.trim() || couponLoading) return;
        setCouponLoading(true);
        setCouponError('');
        try {
            const res = await applyCoupon(survey.id, couponCode);
            if (res.success) {
                setCouponApplied(true);
                setDiscountAmount(res.data.discount_amount);
            } else {
                setCouponError(res.message || 'Invalid coupon');
            }
        } catch (err) {
            setCouponError(err.message || 'Failed to apply coupon');
        } finally {
            setCouponLoading(false);
        }
    };

    const handleRemoveCoupon = () => {
        setCouponCode('');
        setCouponApplied(false);
        setDiscountAmount(0);
        setCouponError('');
    };

    useEffect(() => {
        if (id) {
            fetchSurveyDetail();
        }
    }, [id]);

    useFocusEffect(
        useCallback(() => {
            if (id) {
                fetchSurveyDetail();
            }
        }, [id])
    );

    // Poll broadcast status when survey is in location_detected status (for assigner)
    useEffect(() => {
        if (!survey || !id || survey.status !== 'location_detected' || isSurveyor) {
            setBroadcastStatus(null);
            return;
        }

        const fetchBroadcastStatus = async () => {
            try {
                const result = await getBroadcastStatus(id);
                if (result?.success && result?.data) {
                    setBroadcastStatus(result.data);
                }
            } catch (err) {
                console.log('Broadcast status error:', err.message);
            }
        };

        // Initial fetch
        fetchBroadcastStatus();

        // Poll every 5 seconds
        const interval = setInterval(fetchBroadcastStatus, 5000);

        return () => clearInterval(interval);
    }, [survey?.status, id, isSurveyor]);

    // Smooth 1-second countdown. Re-anchors to the server value on each poll so
    // the timer ticks down every second instead of jumping by ~5s per poll.
    useEffect(() => {
        if (!broadcastStatus?.is_broadcasting || broadcastStatus?.time_remaining_seconds == null) {
            setSecondsLeft(null);
            return;
        }
        const serverRemaining = broadcastStatus.time_remaining_seconds;
        const startedAt = Date.now();
        setSecondsLeft(serverRemaining);
        const tick = setInterval(() => {
            const elapsed = (Date.now() - startedAt) / 1000;
            setSecondsLeft(Math.max(0, Math.round(serverRemaining - elapsed)));
        }, 1000);
        return () => clearInterval(tick);
    }, [broadcastStatus?.time_remaining_seconds, broadcastStatus?.is_broadcasting]);

    const fetchSurveyDetail = async () => {
        try {
            const apiCall = isSurveyor ? surveyorService.getSurveyDetail : getSurveyDetail;
            const response = await apiCall(id);

            // surveyorService.getSurveyDetail returns response.data directly
            // assignerService.getSurveyDetail returns full response, so we need response.data
            const surveyData = isSurveyor ? response : response.data;

            // For surveyors, also fetch photos and documents separately as they might not be included in survey detail
            if (isSurveyor) {
                try {
                    const photosResponse = await surveyorService.getPhotos(id);
                    // photosResponse could be { success: true, data: [...] } or just the array
                    const photosData = photosResponse.data || photosResponse || [];
                    surveyData.photos = Array.isArray(photosData) ? photosData : [];
                } catch (photoErr) {
                    console.log('Could not fetch photos:', photoErr.message);
                    surveyData.photos = [];
                }

                try {
                    const documentsResponse = await surveyorService.getDocuments(id);
                    // documentsResponse could be { success: true, data: [...] } or just the array
                    const documentsData = documentsResponse.data || documentsResponse || [];
                    surveyData.documents = Array.isArray(documentsData) ? documentsData : [];
                } catch (docErr) {
                    console.log('Could not fetch documents:', docErr.message);
                    surveyData.documents = [];
                }
            }

            // Per-session surveyor remarks (both roles can read).
            try {
                const notesResp = isSurveyor
                    ? await surveyorService.getSessionNotes(id)
                    : await getAssignerSessionNotes(id);
                const notesArr = Array.isArray(notesResp) ? notesResp : (notesResp?.data || []);
                setSessionNotes(notesArr);
            } catch (notesErr) {
                console.log('Could not fetch session notes:', notesErr.message);
                setSessionNotes([]);
            }

            // v2 §3 — final invoice. Assigner-only endpoint; a failure here must
            // never take the whole detail screen down.
            if (!isSurveyor) {
                try {
                    setBilling(await getSurveyBill(id));
                } catch (billErr) {
                    console.log('Could not fetch bill:', billErr.message);
                    setBilling(null);
                }
                // v2 §4.4 — no separate reports fetch: the assigner detail payload
                // already runs survey.reports through redactReports, so it carries
                // `locked` / `locked_reason` itself.
            }

            setSurvey(surveyData);
        } catch (error) {
            console.error('Error fetching survey:', error);
            Alert.alert('Error', 'Failed to fetch survey details');
        } finally {
            setLoading(false);
        }
    };

    const handleStartTransit = async () => {
        setActionLoading(true);
        try {
            let { status } = await Location.requestForegroundPermissionsAsync();
            let lat = null, lng = null;
            if (status === 'granted') {
                let loc = await Location.getCurrentPositionAsync({});
                lat = loc.coords.latitude.toString();
                lng = loc.coords.longitude.toString();
            }
            await surveyorService.startTransit(id, lat, lng);
            // Navigate to self-tracking screen for live navigation
            router.replace(`/self-tracking/${id}`);
        } catch (error) {
            Alert.alert('Error', error.message || 'Failed to start transit');
        } finally {
            setActionLoading(false);
        }
    };

    // Calculate distance to site for surveyor
    useEffect(() => {
        const updateDistance = async () => {
            if (!isSurveyor || !survey?.latitude || !survey?.longitude) {
                return;
            }

            let surveyorLat, surveyorLng;

            if (lastLocation) {
                surveyorLat = lastLocation.latitude;
                surveyorLng = lastLocation.longitude;
            } else if (!currentDistance) {
                // Try to get current location if not tracking and no distance set yet
                try {
                    const { status } = await Location.getForegroundPermissionsAsync();
                    if (status === 'granted') {
                        const loc = await Location.getCurrentPositionAsync({});
                        surveyorLat = loc.coords.latitude;
                        surveyorLng = loc.coords.longitude;
                    }
                } catch (e) {
                    // Ignore error
                }
            }

            if (surveyorLat && surveyorLng) {
                const dist = getDistanceFromLatLonInKm(
                    parseFloat(surveyorLat),
                    parseFloat(surveyorLng),
                    parseFloat(survey.latitude),
                    parseFloat(survey.longitude)
                );
                setCurrentDistance(dist);
            }
        };

        updateDistance();
    }, [isSurveyor, survey, lastLocation]);

    // Auto-start location tracking for surveyors if survey is in transit
    useEffect(() => {
        if (isSurveyor && survey?.status === 'in_transit' && !hasStartedTracking.current) {
            hasStartedTracking.current = true;
            startTracking();
        }
        // Stop tracking when status changes to arrived or completed
        if (survey && ['arrived', 'visit_completed', 'report_submitted', 'completed'].includes(survey.status)) {
            stopTracking();
        }
    }, [survey?.status, isSurveyor]);

    const handleMarkArrived = async () => {
        setActionLoading(true);
        try {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Location permission required to mark arrival');
                setActionLoading(false);
                return;
            }
            let loc = await Location.getCurrentPositionAsync({});
            await surveyorService.markArrived(id, loc.coords.latitude.toString(), loc.coords.longitude.toString());
            Alert.alert('Success', 'Marked as Arrived!');
            fetchSurveyDetail();
        } catch (error) {
            Alert.alert('Error', error.message || 'Failed to mark arrival');
        } finally {
            setActionLoading(false);
        }
    };

    const handleSubmitReport = async () => {
        try {
            const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
            if (res.canceled) return;

            setReportFile(res.assets[0]);
            setReportNotes('');
            setReportModalVisible(true);
        } catch (error) {
            Alert.alert('Error', error.message);
        }
    };

    // Reports need the bearer token to be fetched at all, so it is resolved when
    // the preview opens and carried on previewDoc (v2 §4.4).
    const openReportPreview = async (report) => {
        const token = await getAccessToken();
        setPreviewDoc({
            original_file_name: `Report v${report.version}.pdf`,
            file_url: report.report_file_url,
            file_type: 'pdf',
            report_url: buildReportUrl(id, report.report_file_url),
            auth_header: token ? `Bearer ${token}` : null,
        });
    };

    const previewAuthHeaders = (doc) =>
        doc?.auth_header ? { Authorization: doc.auth_header } : undefined;

    const handleDownload = async () => {
        if (!previewDoc) return;
        try {
            // Reports come from the authenticated endpoint; photos and documents
            // are still on the static mount.
            const headers = previewAuthHeaders(previewDoc);
            const fileUrl = previewDoc.report_url
                || getMediaUrl(previewDoc.file_url);
            const fileName = previewDoc.original_file_name || 'download.pdf';
            const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

            // Download to temporary cache first
            const fileUri = FileSystem.documentDirectory + cleanFileName;
            const { uri, status } = await FileSystem.downloadAsync(
                fileUrl,
                fileUri,
                headers ? { headers } : undefined
            );

            if (status && status !== 200) {
                const serverMessage = await fetchReportErrorMessage(fileUrl, headers);
                Alert.alert(
                    status === 402 ? 'Invoice Pending' : 'Unable to open report',
                    serverMessage || 'This file is not available right now.'
                );
                return;
            }

            if (Platform.OS === 'android') {
                // On Android, use Storage Access Framework to save to Downloads (or user choice)
                const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();

                if (permissions.granted) {
                    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
                    // Create file in the selected directory
                    const createdUri = await FileSystem.StorageAccessFramework.createFileAsync(
                        permissions.directoryUri,
                        cleanFileName,
                        'application/pdf'
                    );

                    // Write data to the new file
                    await FileSystem.writeAsStringAsync(createdUri, base64, { encoding: FileSystem.EncodingType.Base64 });
                    Alert.alert('Success', 'File saved successfully!');
                } else {
                    // Fallback to sharing if permission denied, or just notify
                    Alert.alert('Permission needed', 'Storage permission is required to save the file locally.');
                }
            } else {
                // On iOS, Share Sheet is the standard way to "Save to Files"
                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(uri);
                } else {
                    Alert.alert('Success', 'File downloaded to ' + uri);
                }
            }
        } catch (error) {
            console.error('Download error:', error);
            Alert.alert('Error', 'Failed to download file: ' + error.message);
        }
    };

    const confirmSubmitReport = async () => {
        if (!reportFile) return;
        setReportModalVisible(false);
        setActionLoading(true);
        try {
            await surveyorService.submitReport(id, reportFile.uri, reportNotes);
            Alert.alert('Success', 'Report Submitted Successfully!');
            fetchSurveyDetail();
        } catch (err) {
            Alert.alert('Error', err.message);
        } finally {
            setActionLoading(false);
            setReportFile(null);
        }
    };

    // Assigner actions
    // v2 §4 — pay the invoice balance via SabPaisa. Mirrors the advance flow:
    // hand the encrypted payload to the payment WebView. No payment_id is passed,
    // so the WebView skips the advance verify — the server callback settles the bill.
    const handlePayBalance = async () => {
        if (payingBalance) return;
        setPayingBalance(true);
        try {
            const res = await payBalance(survey.id);
            const { enc_data, client_code, sp_url, amount } = res || {};
            if (!enc_data || !client_code || !sp_url) {
                throw new Error('Could not start the payment. Please try again.');
            }
            router.push({
                pathname: '/payment',
                params: {
                    survey_id: survey.id,
                    amount,
                    encData: enc_data,
                    clientCode: client_code,
                    spURL: sp_url,
                },
            });
        } catch (e) {
            Alert.alert('Error', e.message || 'Could not start the payment.');
        } finally {
            setPayingBalance(false);
        }
    };

    const handleMarkSatisfied = async () => {
        Alert.alert(
            'Confirm',
            'Are you satisfied with this survey? This will mark the survey as completed.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Yes, Satisfied',
                    onPress: async () => {
                        setActionLoading(true);
                        try {
                            await markSatisfied(id);
                            Alert.alert('Success', 'Survey marked as satisfied!');
                            fetchSurveyDetail();
                        } catch (err) {
                            Alert.alert('Error', err.message || 'Failed to mark as satisfied');
                        } finally {
                            setActionLoading(false);
                        }
                    }
                }
            ]
        );
    };

    const handleChatWithSurveyor = () => {
        setChatVisible(true);
    };

    // Photo Gallery Helpers
    const getFilteredPhotos = () => {
        if (!survey?.photos) return [];
        // Filter out videos for photo-specific displays
        const photosOnly = survey.photos.filter(p => p.media_type !== 'video');
        if (photoTypeFilter === 'all') return photosOnly;
        if (photoTypeFilter === 'video') return survey.photos.filter(p => p.media_type === 'video');
        if (photoTypeFilter === 'live') return survey.photos.filter(p => p.source_type === 'camera');
        return photosOnly.filter(p => p.photo_type === photoTypeFilter);
    };

    // Get all media (photos + videos)
    const getAllMedia = () => {
        if (!survey?.photos) return [];
        return survey.photos;
    };

    // Get videos only
    const getVideos = () => {
        if (!survey?.photos) return [];
        return survey.photos.filter(p => p.media_type === 'video');
    };

    // Get images only (excluding videos)
    const getImages = () => {
        if (!survey?.photos) return [];
        return survey.photos.filter(p => p.media_type !== 'video');
    };

    const getPhotoUrl = (photo) => getMediaUrl(photo?.file_url);

    // Format captured_at timestamp for display
    const formatCapturedTime = (timestamp) => {
        if (!timestamp) return '';
        const date = parseDateAsLocal(timestamp);
        if (!date || isNaN(date.getTime())) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatCapturedDateTime = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = parseDateAsLocal(timestamp);
        if (!date || isNaN(date.getTime())) return 'N/A';
        // Use device locale instead of forcing Indian locale
        return date.toLocaleString([], {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Format video duration
    const formatDuration = (seconds) => {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleDownloadPhoto = async (photo) => {
        try {
            setIsDownloading(true);

            const photoUrl = getPhotoUrl(photo);
            const filename = `survey_${id}_${photo.photo_type}_${Date.now()}.jpg`;
            const fileUri = FileSystem.cacheDirectory + filename;

            // Download the file into app-private cache
            const downloadResult = await FileSystem.downloadAsync(photoUrl, fileUri);

            if (downloadResult.status !== 200) {
                throw new Error('Download failed');
            }

            // Hand the file to the system share sheet so the user can save it to
            // Photos / Files / Downloads or share it. This avoids the broad
            // READ_MEDIA_IMAGES/READ_MEDIA_VIDEO permissions that Google Play's
            // Photo and Video Permissions policy disallows for infrequent access.
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(downloadResult.uri, {
                    mimeType: 'image/jpeg',
                    dialogTitle: 'Save or share photo',
                    UTI: 'public.jpeg',
                });
            } else {
                Alert.alert('Downloaded', 'Photo downloaded successfully.');
            }
        } catch (error) {
            console.error('Download error:', error);
            Alert.alert('Error', 'Failed to download photo. Please try again.');
        } finally {
            setIsDownloading(false);
        }
    };

    const handleSharePhoto = async (photo) => {
        try {
            const photoUrl = getPhotoUrl(photo);
            await Share.share({
                message: `Survey Photo - ${photo.photo_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
                url: photoUrl,
            });
        } catch (error) {
            console.error('Share error:', error);
        }
    };

    const openPhotoGallery = (index) => {
        setSelectedPhotoIndex(index);
        setPhotoGalleryVisible(true);
    };

    const navigatePhoto = (direction) => {
        const photos = getFilteredPhotos();
        if (direction === 'next' && selectedPhotoIndex < photos.length - 1) {
            setSelectedPhotoIndex(prev => prev + 1);
        } else if (direction === 'prev' && selectedPhotoIndex > 0) {
            setSelectedPhotoIndex(prev => prev - 1);
        }
    };

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color={AppColors.primary} />
            </View>
        );
    }

    if (!survey) {
        return (
            <View style={styles.centered}>
                <MaterialIcons name="error-outline" size={64} color="#CCC" />
                <Text style={styles.errorText}>Survey not found</Text>
            </View>
        );
    }

    const statusConfig = getStatusConfig(survey.status);
    const isMotorSurvey = survey.survey_type?.includes('motor');
    const isMarineSurvey = survey.survey_type?.includes('marine');
    const isInvestigation = survey.survey_type === 'investigation';

    console.log('📋 Type Checks:', { isMotorSurvey, isMarineSurvey, isInvestigation, surveyDetails: survey.details });

    const renderSection = (title, children) => (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{title}</Text>
            </View>
            {children}
        </View>
    );

    // Check if payment is pending for surveyor (status is 'assigned' means waiting for payment).
    // Direct-assigned surveys skip payment entirely — they sit at 'assigned' only until location arrives.
    const isPaymentPending = isSurveyor && survey.status === 'assigned' && !survey.is_direct_assign;

    // Render a locked section with blur overlay for surveyors before payment
    const renderLockedSection = (title, children) => (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{title}</Text>
                <View style={styles.lockBadge}>
                    <MaterialIcons name="lock" size={12} color="#FF9500" />
                    <Text style={styles.lockBadgeText}>Locked</Text>
                </View>
            </View>
            <View style={styles.lockedContent}>
                <View style={styles.lockedOverlay}>
                    <MaterialIcons name="lock-outline" size={32} color="#FF9500" />
                    <Text style={styles.lockedText}>Complete Payment to Unlock</Text>
                    <Text style={styles.lockedSubtext}>This information will be available after payment</Text>
                </View>
            </View>
        </View>
    );

    const renderInfoRow = (label, value, isHalf = false) => (
        <View style={[styles.infoItem, isHalf && { width: '48%' }]}>
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.infoValue}>{value || 'N/A'}</Text>
        </View>
    );

    const getTimelineStatus = (step) => {
        // Full status order including surveyor workflow
        const statusOrder = [
            'pending_assignment',
            'assigned',
            'in_transit',
            'arrived',
            'visit_completed',
            'report_submitted',
            'completed'
        ];
        const currentIndex = statusOrder.indexOf(survey.status);
        const stepIndex = statusOrder.indexOf(step);

        // Current step shows as current, previous as completed
        if (stepIndex < currentIndex) return 'completed';
        if (stepIndex === currentIndex) return 'current';
        return 'pending';
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <MaterialIcons name="arrow-back" size={24} color="#333" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Survey Details</Text>
                <TouchableOpacity style={styles.menuBtn}>
                    <MaterialIcons name="more-vert" size={24} color="#333" />
                </TouchableOpacity>
            </View>

            <ScrollView ref={scrollRef} style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Status Badge & Emergency */}
                <View style={styles.statusRow}>
                    <View style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor, borderColor: statusConfig.color }]}>
                        <View style={[styles.statusDot, { backgroundColor: statusConfig.color }]} />
                        <Text style={[styles.statusLabel, { color: statusConfig.color }]}>{statusConfig.label}</Text>
                    </View>
                    {!!survey.is_emergency && (
                        <View style={[styles.statusBadge, { backgroundColor: '#FFF0F0', borderColor: '#FF3B30' }]}>
                            <MaterialIcons name="warning" size={14} color="#FF3B30" />
                            <Text style={[styles.statusLabel, { color: '#FF3B30', marginLeft: 4 }]}>Emergency</Text>
                        </View>
                    )}
                </View>

                {/* Survey Summary */}
                {renderSection('Survey Summary',
                    <>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Survey Type', survey.survey_type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), true)}
                            {renderInfoRow('Survey ID', `#${survey.laid || `S-${survey.id}`}`, true)}
                        </View>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Claim/Case Reference', survey.case_reference, true)}
                            {renderInfoRow('LAID', survey.laid || 'N/A', true)}
                        </View>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Requested Date', formatDate(survey.created_at))}
                        </View>
                    </>
                )}

                {/* Contact Information - Locked for surveyors when status is 'assigned' (before payment) */}
                {isPaymentPending ? renderLockedSection('Contact Information') : renderSection('Contact Information',
                    <>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Contact Person', survey.contact_person_name, true)}
                            {renderInfoRow('Mobile', survey.contact_person_mobile, true)}
                        </View>
                        {survey.alternate_whatsapp_number && (
                            <View style={styles.infoRow}>
                                {renderInfoRow('Alternate WhatsApp', survey.alternate_whatsapp_number)}
                            </View>
                        )}
                    </>
                )}

                {/* Insurance Details - Locked for surveyors when status is 'assigned' (before payment) */}
                {isPaymentPending ? renderLockedSection('Insurance Details') : renderSection('Insurance Details',
                    <>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Insured Name', survey.name_of_insured, true)}
                            {renderInfoRow('Policy Number', survey.policy_number, true)}
                        </View>
                    </>
                )}

                {/* Location Details - Locked for surveyors when status is 'assigned' (before payment) */}
                {isPaymentPending ? renderLockedSection('Location Details') : renderSection('Location Details',
                    <>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Location Method', formatLocationMethod(survey.location_method), isSurveyor)}
                            {isSurveyor && currentDistance !== null && renderInfoRow('Distance to Site', `${currentDistance.toFixed(2)} km`, true)}
                        </View>
                        {(survey.latitude && survey.longitude) && (
                            <View style={styles.infoRow}>
                                {renderInfoRow('Latitude', survey.latitude, true)}
                                {renderInfoRow('Longitude', survey.longitude, true)}
                            </View>
                        )}
                        {/* Map View */}
                        {(survey.latitude && survey.longitude) && (
                            <View style={styles.mapContainer}>
                                <MapView
                                    style={styles.map}
                                    initialRegion={{
                                        latitude: parseFloat(survey.latitude),
                                        longitude: parseFloat(survey.longitude),
                                        latitudeDelta: 0.01,
                                        longitudeDelta: 0.01,
                                    }}
                                    scrollEnabled={false}
                                    zoomEnabled={false}
                                >
                                    <Marker
                                        coordinate={{
                                            latitude: parseFloat(survey.latitude),
                                            longitude: parseFloat(survey.longitude),
                                        }}
                                        title={survey.address || 'Survey Location'}
                                        description={`${survey.city || ''}, ${survey.state || ''}`}
                                    >
                                        <View style={styles.mapMarker}>
                                            <MaterialIcons name="location-on" size={28} color="#FF3B30" />
                                        </View>
                                    </Marker>
                                </MapView>
                            </View>
                        )}
                        <View style={styles.addressRow}>
                            <MaterialIcons name="location-on" size={20} color="#2196F3" />
                            <View style={styles.addressText}>
                                <Text style={styles.addressMain}>
                                    {survey.address || `${survey.city || ''}, ${survey.state || ''}`}
                                </Text>
                                {survey.pincode && (
                                    <Text style={styles.addressSub}>Pincode: {survey.pincode}</Text>
                                )}
                            </View>
                        </View>
                        {/* Single Open-in-Maps CTA — prefers assigner-provided link, falls back to coordinates */}
                        {(() => {
                            const normalizeMapsUrl = (raw) => {
                                if (typeof raw !== 'string') return null;
                                let s = raw.trim();
                                if (!s) return null;
                                const lower = s.toLowerCase();
                                const lastIdx = Math.max(lower.lastIndexOf('http://'), lower.lastIndexOf('https://'));
                                if (lastIdx >= 0) s = s.slice(lastIdx);
                                else s = `https://${s.replace(/^\/+/, '')}`;
                                try {
                                    const u = new URL(s);
                                    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
                                } catch {
                                    return null;
                                }
                            };
                            const coordFallback = (survey.latitude && survey.longitude)
                                ? Platform.select({
                                    ios: `maps:0,0?q=${survey.latitude},${survey.longitude}`,
                                    android: `geo:0,0?q=${survey.latitude},${survey.longitude}(Survey Location)`,
                                })
                                : null;
                            const addressQuery = [survey.address, survey.city, survey.state, survey.pincode].filter(Boolean).join(', ');
                            const addressFallback = (!coordFallback && addressQuery)
                                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery)}`
                                : null;
                            const mapsUrl = normalizeMapsUrl(survey.google_maps_link) || coordFallback || addressFallback;
                            return mapsUrl ? (
                                <TouchableOpacity
                                    style={styles.gmapsLinkBtn}
                                    onPress={() => Linking.openURL(mapsUrl).catch(() =>
                                        Alert.alert('Unable to open link', 'No map app can open this URL.')
                                    )}
                                >
                                    <MaterialIcons name="map" size={18} color="#FFF" />
                                    <Text style={styles.gmapsLinkBtnText}>Open in Google Maps</Text>
                                    <MaterialIcons name="open-in-new" size={16} color="#FFF" style={{ marginLeft: 'auto' }} />
                                </TouchableOpacity>
                            ) : null;
                        })()}
                        {/* SMS Link for Assigners */}
                        {!isSurveyor && survey.sms_link && (
                            <View style={styles.smsLinkContainer}>
                                <View style={styles.smsLinkHeader}>
                                    <MaterialIcons name="link" size={18} color={AppColors.primary} />
                                    <Text style={styles.smsLinkLabel}>Location Share Link</Text>
                                </View>
                                <View style={styles.smsLinkRow}>
                                    <Text style={styles.smsLinkText} numberOfLines={1}>{survey.sms_link}</Text>
                                    <View style={styles.smsLinkActions}>
                                        <TouchableOpacity
                                            style={styles.smsLinkBtn}
                                            onPress={async () => {
                                                await Clipboard.setStringAsync(survey.sms_link);
                                                Alert.alert('Copied', 'Link copied to clipboard');
                                            }}
                                        >
                                            <MaterialIcons name="content-copy" size={18} color="#666" />
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.smsLinkBtn, { backgroundColor: AppColors.primary }]}
                                            onPress={async () => {
                                                try {
                                                    await Share.share({
                                                        message: `Please share your location using this link: ${survey.sms_link}`,
                                                    });
                                                } catch (error) {
                                                    console.error('Share error:', error);
                                                }
                                            }}
                                        >
                                            <MaterialIcons name="share" size={18} color="#FFF" />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>
                        )}
                    </>
                )}

                {/* Vehicle Details (for motor surveys) */}
                {isMotorSurvey && renderSection('Vehicle Details',
                    <>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Vehicle Type', survey.details?.vehicle_type ? survey.details.vehicle_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'N/A', true)}
                            {renderInfoRow('Category', survey.details?.vehicle_category ? survey.details.vehicle_category.charAt(0).toUpperCase() + survey.details.vehicle_category.slice(1) : 'N/A', true)}
                        </View>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Vehicle Number', survey.details?.vehicle_number || 'N/A')}
                        </View>
                    </>
                )}

                {/* Workshop Details (for motor_final surveys) */}
                {survey.survey_type === 'motor_final' && (survey.details?.workshop_name || survey.details?.workshop_advisor_name || survey.details?.workshop_advisor_contact) && renderSection('Workshop Details',
                    <>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Workshop Name', survey.details?.workshop_name, true)}
                            {renderInfoRow('Advisor Name', survey.details?.workshop_advisor_name, true)}
                        </View>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Contact', survey.details?.workshop_advisor_contact)}
                        </View>
                    </>
                )}

                {/* Marine Details (for marine surveys) */}
                {isMarineSurvey && renderSection('Marine/Cargo Details',
                    <>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Commodity', survey.details?.commodity, true)}
                        </View>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Consignee', survey.details?.name_of_consignee, true)}
                            {renderInfoRow('Consignor', survey.details?.name_of_consignor, true)}
                        </View>
                        {survey.details?.invoices && survey.details.invoices.length > 0 && (
                            <View style={styles.subSection}>
                                <Text style={styles.subSectionTitle}>Invoices</Text>
                                {survey.details.invoices.map((inv, idx) => (
                                    <View key={idx} style={styles.listItem}>
                                        <Text style={styles.listItemText}>#{inv.invoice_number} - ₹{inv.invoice_amount || 'N/A'} ({inv.invoice_date || 'N/A'})</Text>
                                    </View>
                                ))}
                            </View>
                        )}
                        {survey.details?.gr_entries && survey.details.gr_entries.length > 0 && (
                            <View style={styles.subSection}>
                                <Text style={styles.subSectionTitle}>GR Entries</Text>
                                {survey.details.gr_entries.map((gr, idx) => (
                                    <View key={idx} style={styles.listItem}>
                                        <Text style={styles.listItemText}>#{gr.gr_number} ({gr.gr_date || 'N/A'})</Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </>
                )}

                {/* Investigation Details */}
                {isInvestigation && renderSection('Investigation Details',
                    <>
                        <View style={styles.infoRow}>
                            {renderInfoRow('Loss Item Type', survey.details?.loss_item_type ? survey.details.loss_item_type.charAt(0).toUpperCase() + survey.details.loss_item_type.slice(1) : 'N/A')}
                        </View>
                        {survey.details?.loss_item_type === 'vehicle' && (
                            <View style={styles.infoRow}>
                                {renderInfoRow('Vehicle Number', survey.details?.investigation_vehicle_number)}
                            </View>
                        )}
                        {survey.details?.loss_item_type === 'cattle' && (
                            <View style={styles.infoRow}>
                                {renderInfoRow('Tag Number', survey.details?.cattle_tag_number, true)}
                                {renderInfoRow('Cattle Name', survey.details?.cattle_name, true)}
                            </View>
                        )}
                        {survey.details?.loss_item_type === 'human' && (
                            <>
                                <View style={styles.infoRow}>
                                    {renderInfoRow('Person Name', survey.details?.human_name, true)}
                                    {renderInfoRow('Contact', survey.details?.human_contact_number, true)}
                                </View>
                                <View style={styles.infoRow}>
                                    {renderInfoRow('Relation', survey.details?.human_relation)}
                                </View>
                            </>
                        )}
                        {survey.details?.loss_item_type === 'others' && (
                            <View style={styles.infoRow}>
                                {renderInfoRow('Item Description', survey.details?.other_loss_item_name)}
                            </View>
                        )}
                    </>
                )}

                {/* Instructions / Notes */}
                {survey.instructions && renderSection('Instructions / Notes',
                    <Text style={styles.instructionsText}>{survey.instructions}</Text>
                )}

                {/* Cause of Loss */}
                {survey.cause_of_loss && renderSection('Cause of Loss',
                    <Text style={styles.instructionsText}>{survey.cause_of_loss}</Text>
                )}

                {/* Assigned Surveyor - Hidden from assigners when status is 'assigned' (before payment) */}
                {survey.surveyor_name && (isSurveyor || survey.status !== 'assigned') && renderSection('Assigned Surveyor',
                    <View style={styles.surveyorRow}>
                        {survey.surveyor_picture ? (
                            <Image
                                source={{ uri: survey.surveyor_picture }}
                                style={styles.surveyorAvatar}
                            />
                        ) : (
                            <View style={[styles.surveyorAvatar, styles.surveyorAvatarPlaceholder]}>
                                <Text style={styles.surveyorAvatarText}>
                                    {survey.surveyor_name?.[0]?.toUpperCase() || 'S'}
                                </Text>
                            </View>
                        )}
                        <View style={styles.surveyorInfo}>
                            <View style={styles.surveyorNameRow}>
                                <Text style={styles.surveyorName}>{survey.surveyor_name}</Text>
                                <MaterialIcons name="verified" size={16} color="#2196F3" />
                            </View>
                            <Text style={styles.surveyorPhone}>{survey.surveyor_phone || 'N/A'}</Text>
                        </View>
                        {['visit_completed', 'report_submitted'].includes(survey.status) && (
                            <TouchableOpacity style={styles.chatBtn} onPress={handleChatWithSurveyor}>
                                <MaterialIcons name="chat-bubble" size={20} color="#FFF" />
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {/* Pricing Tier - Only show for assigner after payment complete (not when status is 'assigned'); hidden for direct-assign surveys (no payment from assigner) */}
                {!isSurveyor && survey.surveyor_id && survey.pricing_tier && survey.status !== 'assigned' && !survey.is_direct_assign && renderSection('Your Survey Pricing',
                    <View style={styles.pricingCard}>
                        <View style={styles.pricingRow}>
                            <View style={styles.pricingItem}>
                                <Text style={styles.pricingLabel}>Pricing Tier</Text>
                                <Text style={styles.pricingValue}>{survey.pricing_tier.tier_name}</Text>
                            </View>
                            <View style={styles.pricingItem}>
                                <Text style={styles.pricingLabel}>Distance</Text>
                                <Text style={styles.pricingValue}>{survey.distance_from_assigner_km !== null && survey.distance_from_assigner_km !== undefined ? `${parseFloat(survey.distance_from_assigner_km).toFixed(1)} km` : 'N/A'}</Text>
                            </View>
                        </View>
                        <View style={styles.pricingTotal}>
                            <Text style={styles.pricingTotalLabel}>Survey Cost</Text>
                            <Text style={styles.pricingTotalValue}>₹{parseFloat(survey.pricing_tier.price_amount).toLocaleString('en-IN')}</Text>
                        </View>
                    </View>
                )}

                {/* Final Invoice (v2 §3).
                    billing_state 'not_billable' (direct assign) deliberately renders
                    nothing — those surveys are free and the existing copy already
                    says so. */}
                {!isSurveyor && billing?.billing_state === 'awaiting_bill' && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>Invoice</Text>
                        </View>
                        <View style={styles.billPendingRow}>
                            <MaterialIcons name="receipt-long" size={18} color="#999" />
                            <Text style={styles.billPendingText}>
                                {billing.message || 'Final invoice not raised yet.'}
                            </Text>
                        </View>
                    </View>
                )}

                {!isSurveyor && billing?.bill && (() => {
                    const b = billing.bill;
                    const settled = billing.billing_state === 'settled';
                    const balance = parseFloat(b.balance_due || 0);
                    // A negative balance means the advance overshot the invoice —
                    // the platform owes the assigner, never "₹-804 due".
                    const isCredit = balance < 0;
                    const gstPercent = parseFloat(b.gst_percent || 0);
                    const cgst = parseFloat(b.cgst_amount || 0);
                    const sgst = parseFloat(b.sgst_amount || 0);
                    const igst = parseFloat(b.igst_amount || 0);
                    const alreadyPaid = parseFloat(b.amount_paid || 0);

                    const billLine = (label, sub, value, valueStyle) => (
                        <View style={styles.billRow} key={label}>
                            <View style={styles.billLabelCol}>
                                <Text style={styles.billLabel}>{label}</Text>
                                {sub ? <Text style={styles.billSub}>{sub}</Text> : null}
                            </View>
                            <Text style={[styles.billValue, valueStyle]}>{value}</Text>
                        </View>
                    );

                    return (
                        <View
                            style={styles.section}
                            onLayout={(e) => { invoiceOffsetRef.current = e.nativeEvent.layout.y; }}
                        >
                            <View style={styles.sectionHeader}>
                                <Text style={styles.sectionTitle}>Invoice</Text>
                                <View style={[styles.billBadge, settled && styles.billBadgeSettled]}>
                                    <MaterialIcons
                                        name={settled ? 'check-circle' : 'schedule'}
                                        size={12}
                                        color={settled ? '#2E7D32' : '#E65100'}
                                    />
                                    <Text style={[styles.billBadgeText, settled && styles.billBadgeTextSettled]}>
                                        {isCredit ? 'Credit' : settled ? 'Settled' : 'Balance Due'}
                                    </Text>
                                </View>
                            </View>

                            {b.invoice_number ? (
                                <Text style={styles.billInvoiceNumber}>{b.invoice_number}</Text>
                            ) : null}

                            {billLine('Professional Fee', null, formatINR(b.fee_amount))}
                            {billLine(
                                'Conveyance',
                                `${parseFloat(b.conveyance_km || 0).toFixed(2)} km × ${formatINR(b.conveyance_rate)}/km`,
                                formatINR(b.conveyance_amount)
                            )}
                            {billLine('DA / Toll', null, formatINR(b.da_toll_amount))}
                            {billLine(
                                'Photos',
                                `${b.photo_count || 0} × ${formatINR(b.photo_rate)}`,
                                formatINR(b.photo_amount)
                            )}

                            <View style={styles.billDivider} />

                            {billLine('Taxable Value', null, formatINR(b.taxable_value))}
                            {igst > 0
                                ? billLine(`IGST @ ${gstPercent}%`, null, formatINR(igst))
                                : (cgst > 0 || sgst > 0) ? (
                                    <>
                                        {billLine(`CGST @ ${gstPercent / 2}%`, null, formatINR(cgst))}
                                        {billLine(`SGST @ ${gstPercent / 2}%`, null, formatINR(sgst))}
                                    </>
                                ) : null}

                            <View style={styles.billDivider} />

                            <View style={styles.billRow}>
                                <Text style={styles.billTotalLabel}>Total (incl. GST)</Text>
                                <Text style={styles.billTotalValue}>{formatINR(b.total_amount)}</Text>
                            </View>

                            {billLine('Less: Advance paid', null, `− ${formatINR(b.advance_adjusted)}`, styles.billCreditValue)}
                            {alreadyPaid > 0
                                ? billLine('Less: Balance already paid', null, `− ${formatINR(alreadyPaid)}`, styles.billCreditValue)
                                : null}

                            <View style={styles.billBalanceRow}>
                                <Text style={styles.billBalanceLabel}>
                                    {isCredit ? 'Credit owed to you' : settled ? 'Balance' : 'Balance due'}
                                </Text>
                                <Text style={[
                                    styles.billBalanceValue,
                                    (isCredit || settled) && styles.billBalanceValueSettled,
                                ]}>
                                    {formatINR(Math.abs(balance))}
                                </Text>
                            </View>

                            <Text style={styles.billNote}>
                                {isCredit
                                    ? 'Your advance exceeded this invoice. The difference is a credit in your favour.'
                                    : billing.message}
                            </Text>

                            {/* v2 §4 — pay the outstanding balance via SabPaisa */}
                            {balance > 0 && !settled && (
                                <>
                                    <TouchableOpacity
                                        style={[styles.payBalanceBtn, payingBalance && styles.payBalanceBtnDisabled]}
                                        onPress={handlePayBalance}
                                        disabled={payingBalance}
                                        activeOpacity={0.85}
                                    >
                                        {payingBalance ? (
                                            <ActivityIndicator color="#FFF" size="small" />
                                        ) : (
                                            <>
                                                <MaterialIcons name="lock-open" size={18} color="#FFF" />
                                                <Text style={styles.payBalanceBtnText}>Pay {formatINR(balance)}</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                    <Text style={styles.payBalanceHint}>
                                        Secure payment via SabPaisa. Your report unlocks once the payment is confirmed.
                                    </Text>
                                </>
                            )}
                        </View>
                    );
                })()}



                {/* Assigner Payment CTA - For assigned surveys (Blind Assignment) - Improved UI */}
                {!isSurveyor && survey.status === 'assigned' && !survey.is_direct_assign && (
                    <View style={styles.paymentCardContainer}>
                        {/* Gradient Header */}
                        <View style={styles.paymentCardHeader}>
                            <View style={styles.paymentIconContainer}>
                                <MaterialIcons name="lock-outline" size={28} color="#FFF" />
                            </View>
                            <View style={styles.paymentHeaderText}>
                                <Text style={styles.paymentCardTitle}>Surveyor Allocated</Text>
                                <Text style={styles.paymentCardSubtitle}>Payment required to proceed</Text>
                            </View>
                        </View>

                        {/* Pricing Details */}
                        <View style={styles.paymentCardBody}>
                            <View style={styles.paymentPricingRow}>
                                <View style={styles.paymentPricingItem}>
                                    <Text style={styles.paymentPricingLabel}>Pricing Tier</Text>
                                    <Text style={styles.paymentPricingValue}>{survey.pricing_tier?.tier_name || 'Standard'}</Text>
                                </View>
                                <View style={styles.paymentPricingDivider} />
                                <View style={styles.paymentPricingItem}>
                                    <Text style={styles.paymentPricingLabel}>Distance</Text>
                                    <Text style={styles.paymentPricingValue}>
                                        {survey.distance_from_assigner_km !== null && survey.distance_from_assigner_km !== undefined
                                            ? `${parseFloat(survey.distance_from_assigner_km).toFixed(1)} km`
                                            : 'N/A'}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.paymentAmountContainer}>
                                <Text style={styles.paymentAmountLabel}>
                                    {couponApplied ? 'Amount to Pay' : 'Total Amount'}
                                </Text>
                                <Text style={styles.paymentAmountValue}>
                                    {couponApplied ? (
                                        <>
                                            <Text style={{ textDecorationLine: 'line-through', fontSize: 16, color: '#666' }}>
                                                ₹{survey.pricing_tier?.price_amount ? parseFloat(survey.pricing_tier.price_amount).toLocaleString('en-IN') : '0'}
                                            </Text>
                                            {' '}
                                            <Text>
                                                ₹{((parseFloat(survey.pricing_tier?.price_amount) || 0) - discountAmount).toLocaleString('en-IN')}
                                            </Text>
                                        </>
                                    ) : (
                                        `₹${survey.pricing_tier?.price_amount ? parseFloat(survey.pricing_tier.price_amount).toLocaleString('en-IN') : '0'}`
                                    )}
                                </Text>
                            </View>

                            {/* Coupon Section - Inside payment card */}
                            {!isTimedOut && (
                                <View style={{ marginTop: 12 }}>
                                    {!couponApplied ? (
                                        <>
                                            <Text style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Have a coupon?</Text>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                <TextInput
                                                    style={{ flex: 1, padding: 10, fontSize: 14, textTransform: 'uppercase', borderWidth: 1, borderColor: '#DDD', borderRadius: 8, backgroundColor: '#FFF' }}
                                                    placeholder="Enter coupon code"
                                                    placeholderTextColor="#999"
                                                    value={couponCode}
                                                    onChangeText={setCouponCode}
                                                    autoCapitalize="characters"
                                                    maxLength={15}
                                                />
                                                <TouchableOpacity
                                                    onPress={handleApplyCoupon}
                                                    disabled={couponLoading || !couponCode.trim()}
                                                    style={{ backgroundColor: '#FFB300', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8 }}
                                                >
                                                    {couponLoading ? (
                                                        <ActivityIndicator size="small" color="#FFF" />
                                                    ) : (
                                                        <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 14 }}>Apply</Text>
                                                    )}
                                                </TouchableOpacity>
                                            </View>
                                            {couponError ? <Text style={{ color: '#D32F2F', fontSize: 12, marginTop: 4 }}>{couponError}</Text> : null}
                                        </>
                                    ) : (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#E8F5E9', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#4CAF50' }}>
                                            <View>
                                                <Text style={{ fontSize: 14, fontWeight: '600', color: '#2E7D32' }}>Coupon Applied!</Text>
                                                <Text style={{ fontSize: 12, color: '#388E3C' }}>You save ₹{discountAmount.toLocaleString('en-IN')}</Text>
                                            </View>
                                            <TouchableOpacity onPress={handleRemoveCoupon}>
                                                <MaterialIcons name="close" size={24} color="#D32F2F" />
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            )}

                            <Text style={styles.paymentNote}>
                                Complete payment to unlock surveyor details and start the survey process.
                            </Text>
                        </View>
                    </View>
                )}

                {/* Submitted Reports.
                    v2 §4.4 — a locked report keeps all of its metadata; only the file
                    is withheld. Hiding the row would make a finished survey look
                    unfinished. */}
                {survey.reports && survey.reports.length > 0 && renderSection('Submitted Reports',
                    <View style={styles.reportsList}>
                        {survey.reports.map((report, index) => {
                            const isLocked = report.locked === true || !report.report_file_url;

                            if (isLocked) {
                                return (
                                    <View key={report.id || index} style={[styles.reportItem, styles.reportItemLocked]}>
                                        <View style={[styles.reportIconContainer, styles.reportIconContainerLocked]}>
                                            <MaterialIcons name="lock-outline" size={24} color="#FFF" />
                                        </View>
                                        <View style={styles.reportInfo}>
                                            <Text style={styles.reportTitle}>Version {report.version}</Text>
                                            <Text style={styles.reportSubtitle}>{formatDate(report.created_at)}</Text>
                                            {report.surveyor_notes ? (
                                                <Text style={styles.reportNotes} numberOfLines={2}>{report.surveyor_notes}</Text>
                                            ) : null}
                                            <Text style={styles.reportLockedReason}>
                                                {report.locked_reason
                                                    || billing?.message
                                                    || 'Settle the invoice balance to download this report.'}
                                            </Text>
                                            {!isSurveyor && billing?.bill ? (
                                                <TouchableOpacity
                                                    style={styles.reportInvoiceLink}
                                                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                                    accessibilityRole="button"
                                                    accessibilityLabel="View the invoice for this survey"
                                                    onPress={() => scrollRef.current?.scrollTo({
                                                        y: Math.max(0, invoiceOffsetRef.current - 12),
                                                        animated: true,
                                                    })}
                                                >
                                                    <Text style={styles.reportInvoiceLinkText}>View invoice</Text>
                                                    <MaterialIcons name="arrow-upward" size={14} color={AppColors.primary} />
                                                </TouchableOpacity>
                                            ) : null}
                                        </View>
                                    </View>
                                );
                            }

                            return (
                                <TouchableOpacity
                                    key={report.id || index}
                                    style={styles.reportItem}
                                    onPress={() => openReportPreview(report)}
                                >
                                    <View style={styles.reportIconContainer}>
                                        <MaterialIcons name="description" size={24} color="#FFF" />
                                    </View>
                                    <View style={styles.reportInfo}>
                                        <Text style={styles.reportTitle}>Version {report.version}</Text>
                                        <Text style={styles.reportSubtitle}>{formatDate(report.created_at)}</Text>
                                        {report.surveyor_notes ? (
                                            <Text style={styles.reportNotes} numberOfLines={2}>{report.surveyor_notes}</Text>
                                        ) : null}
                                    </View>
                                    <MaterialIcons name="chevron-right" size={24} color="#CCC" />
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                {/* Documents */}
                {renderSection('Documents Uploaded',
                    <>
                        <View style={styles.docGrid}>
                            {(survey.documents || []).slice(0, 4).map((doc, index) => (
                                <TouchableOpacity
                                    key={doc.id || index}
                                    style={styles.docThumbContainer}
                                    onPress={() => setPreviewDoc(doc)}
                                >
                                    {(doc.file_type === 'pdf' || doc.file_url?.toLowerCase().endsWith('.pdf')) ? (
                                        <View style={styles.pdfThumb}>
                                            <MaterialIcons name="picture-as-pdf" size={40} color="#FF3B30" />
                                            <Text style={styles.pdfThumbText} numberOfLines={1}>
                                                {doc.original_file_name || 'PDF Document'}
                                            </Text>
                                        </View>
                                    ) : (
                                        <Image
                                            source={{ uri: getPhotoUrl(doc) }}
                                            style={styles.docThumb}
                                            contentFit="cover"
                                            placeholder={blurhash}
                                            transition={200}
                                        />
                                    )}
                                </TouchableOpacity>
                            ))}
                        </View>
                        {(!survey.documents || survey.documents.length === 0) && (
                            <Text style={styles.noDocuments}>No documents uploaded yet</Text>
                        )}
                        {survey.documents?.length > 4 && (
                            <TouchableOpacity style={styles.viewAllBtn}>
                                <Text style={styles.viewAllText}>View all</Text>
                            </TouchableOpacity>
                        )}
                    </>
                )}

                {/* Survey Timeline */}
                {/* Survey Timeline */}
                {renderSection('Survey Timeline',
                    <View style={styles.timeline}>
                        {[
                            { key: 'pending_assignment', label: 'Survey Requested', date: survey.created_at },
                            { key: 'assigned', label: 'Surveyor Assigned', date: survey.surveyor_assigned_at || survey.assigned_at },
                            // v2 §5.1: `surveyor_started_at` never existed — this row
                            // rendered blank since it was written. The real column is
                            // `in_transit_at` (migration 018).
                            { key: 'in_transit', label: 'Surveyor In Transit', date: survey.in_transit_at },
                            { key: 'arrived', label: 'Surveyor Arrived', date: survey.surveyor_arrived_at },
                            { key: 'visit_completed', label: 'Inspection Completed', date: survey.visit_completed_at },
                            { key: 'report_submitted', label: 'Report Submitted', date: survey.report_submitted_at },
                            { key: 'completed', label: 'Survey Completed', date: survey.completed_at },
                        ].map((step, index, arr) => {
                            // Normalize backend status to frontend status key
                            let currentStatus = survey.status;
                            if (currentStatus === 'pending') currentStatus = 'pending_assignment';
                            if (currentStatus === 'finished') currentStatus = 'completed';

                            const getTimelineStatus = (stepKey) => {
                                const statusOrder = [
                                    'pending_assignment',
                                    'assigned',
                                    'in_transit',
                                    'arrived',
                                    'visit_completed',
                                    'report_submitted',
                                    'completed'
                                ];
                                const currentIndex = statusOrder.indexOf(currentStatus);
                                const stepIndex = statusOrder.indexOf(stepKey);

                                if (currentIndex === -1) return 'pending'; // Fallback
                                if (stepIndex < currentIndex) return 'completed';
                                if (stepIndex === currentIndex) return 'current';
                                return 'pending';
                            };

                            const status = getTimelineStatus(step.key);
                            return (
                                <View key={step.key} style={styles.timelineItem}>
                                    <View style={styles.timelineLeft}>
                                        <View style={[
                                            styles.timelineDot,
                                            status === 'completed' && styles.timelineDotCompleted,
                                            status === 'current' && styles.timelineDotCurrent,
                                        ]}>
                                            {status === 'completed' && (
                                                <MaterialIcons name="check" size={12} color="#FFF" />
                                            )}
                                        </View>
                                        {index < arr.length - 1 && (
                                            <View style={[
                                                styles.timelineLine,
                                                status === 'completed' && styles.timelineLineCompleted,
                                            ]} />
                                        )}
                                    </View>
                                    <View style={styles.timelineContent}>
                                        <Text style={[
                                            styles.timelineLabel,
                                            status === 'current' && styles.timelineLabelCurrent,
                                        ]}>
                                            {step.label}
                                        </Text>
                                        {step.date && status !== 'pending' && (
                                            <Text style={styles.timelineDate}>{formatDate(step.date)}</Text>
                                        )}
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )}

                {/* Survey Photos (uploaded by surveyor) - visible to both assigner and surveyor */}
                {/* Per-session surveyor remarks (one block per visit) */}
                {sessionNotes.length > 0 && renderSection('Surveyor Remarks',
                    <View>
                        {sessionNotes.map((sn) => (
                            <View key={sn.session_number} style={styles.sessionNoteRow}>
                                <Text style={styles.sessionNoteLabel}>Visit {sn.session_number}</Text>
                                <Text style={styles.instructionsText}>
                                    {sn.notes || 'No remarks'}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}

                {survey.photos && survey.photos.length > 0 && renderSection('Survey Media',
                    <View style={styles.surveyPhotosSection}>
                        {/* Photo Type Filter Tabs */}
                        <View style={styles.photoFilterTabs}>
                            {[
                                { key: 'all', label: 'All Photos', icon: 'photo-library' },
                                { key: 'selfie', label: 'Selfies', icon: 'person' },
                                { key: 'live', label: 'Live', icon: 'camera-alt' },
                                { key: 'video', label: 'Videos', icon: 'videocam' },
                            ].map((tab) => {
                                let count;
                                if (tab.key === 'all') {
                                    count = getImages().length;
                                } else if (tab.key === 'video') {
                                    count = getVideos().length;
                                } else {
                                    count = survey.photos.filter(p => p.photo_type === tab.key && p.media_type !== 'video').length;
                                }
                                if (tab.key !== 'all' && count === 0) return null;
                                return (
                                    <TouchableOpacity
                                        key={tab.key}
                                        style={[
                                            styles.photoFilterTab,
                                            photoTypeFilter === tab.key && styles.photoFilterTabActive
                                        ]}
                                        onPress={() => setPhotoTypeFilter(tab.key)}
                                    >
                                        <MaterialIcons
                                            name={tab.icon}
                                            size={14}
                                            color={photoTypeFilter === tab.key ? '#FFF' : '#666'}
                                        />
                                        <Text style={[
                                            styles.photoFilterTabText,
                                            photoTypeFilter === tab.key && styles.photoFilterTabTextActive
                                        ]}>
                                            {tab.label} ({count})
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        {/* Photo/Video Grid — grouped by visit/session */}
                        {(() => {
                            const filtered = getFilteredPhotos();
                            const groups = filtered.reduce((acc, media, idx) => {
                                const s = Number(media.session_number) || 1;
                                (acc[s] ||= []).push({ media, index: idx });
                                return acc;
                            }, {});
                            const sortedSessions = Object.keys(groups).map(Number).sort((a, b) => a - b);
                            const showSessionHeader = sortedSessions.length > 1;
                            return sortedSessions.map((sessionNum) => (
                                <View key={`session-${sessionNum}`} style={showSessionHeader ? styles.sessionGroup : null}>
                                    {showSessionHeader && (
                                        <View style={styles.sessionGroupHeader}>
                                            <Text style={styles.sessionGroupBadge}>Visit {sessionNum}</Text>
                                            <Text style={styles.sessionGroupCount}>{groups[sessionNum].length} item(s)</Text>
                                        </View>
                                    )}
                                    <View style={styles.surveyPhotosGrid}>
                                        {groups[sessionNum].map(({ media, index }) => (
                                <TouchableOpacity
                                    key={media.id || index}
                                    style={styles.surveyPhotoThumb}
                                    onPress={() => openPhotoGallery(index)}
                                    activeOpacity={0.8}
                                >
                                    {media.media_type === 'video' ? (
                                        // Video Thumbnail
                                        <View style={[styles.surveyPhotoImage, styles.videoThumbPlaceholder]}>
                                            <MaterialIcons name="videocam" size={24} color="#666" />
                                            {/* Video Play Overlay */}
                                            <View style={styles.videoPlayOverlay}>
                                                <MaterialIcons name="play-circle-filled" size={32} color="rgba(255,255,255,0.9)" />
                                            </View>
                                            {/* Duration Badge */}
                                            {media.video_duration_seconds > 0 && (
                                                <View style={styles.videoDurationBadge}>
                                                    <Text style={styles.videoDurationText}>
                                                        {formatDuration(media.video_duration_seconds)}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>
                                    ) : (
                                        // Photo Image
                                        <Image
                                            source={{ uri: getPhotoUrl(media) }}
                                            style={styles.surveyPhotoImage}
                                            contentFit="cover"
                                        />
                                    )}

                                    {/* Date/Time Stamp Badge */}
                                    {(media.captured_at || media.created_at) && (
                                        <View style={styles.mediaTimestampBadge}>
                                            <MaterialIcons name="access-time" size={8} color="#FFF" />
                                            <Text style={styles.mediaTimestampText}>
                                                {formatCapturedTime(media.captured_at || media.created_at)}
                                            </Text>
                                        </View>
                                    )}

                                    {/* Photo Type Badge (only for non-videos) */}
                                    {media.media_type !== 'video' && (
                                        <View style={[
                                            styles.photoTypeBadge,
                                            media.photo_type === 'selfie' && styles.photoTypeBadgeSelfie,
                                            media.photo_type === 'vehicle' && styles.photoTypeBadgeVehicle,
                                        ]}>
                                            <MaterialIcons
                                                name={
                                                    media.photo_type === 'selfie' ? 'person' :
                                                        media.photo_type === 'vehicle' ? 'directions-car' : 'camera-alt'
                                                }
                                                size={10}
                                                color="#FFF"
                                            />
                                        </View>
                                    )}

                                    {/* Source Badge - Camera or Gallery */}
                                    {media.source_type && (
                                        <View style={[
                                            styles.photoSourceBadge,
                                            media.source_type === 'gallery' ? styles.photoSourceBadgeGallery : styles.photoSourceBadgeCamera
                                        ]}>
                                            <MaterialIcons
                                                name={media.source_type === 'gallery'
                                                    ? (media.media_type === 'video' ? 'video-library' : 'photo-library')
                                                    : (media.media_type === 'video' ? 'videocam' : 'camera-alt')}
                                                size={10}
                                                color="#FFF"
                                            />
                                        </View>
                                    )}

                                    {/* Tap indicator */}
                                    <View style={styles.photoTapIndicator}>
                                        <MaterialIcons
                                            name={media.media_type === 'video' ? 'play-arrow' : 'zoom-in'}
                                            size={16}
                                            color="rgba(255,255,255,0.8)"
                                        />
                                    </View>
                                </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>
                            ));
                        })()}

                        {/* Photos/Videos Count & Info */}
                        <View style={styles.surveyPhotosInfo}>
                            <MaterialIcons
                                name={photoTypeFilter === 'video' ? 'videocam' : 'photo-camera'}
                                size={16}
                                color="#888"
                            />
                            <Text style={styles.surveyPhotosCount}>
                                {getFilteredPhotos().length} {photoTypeFilter === 'video' ? 'video' : 'photo'}{getFilteredPhotos().length !== 1 ? 's' : ''}
                                {' '}• Total: {getImages().length} photos, {getVideos().length} videos • Tap to view
                            </Text>
                        </View>
                    </View>
                )}

                <View style={{ height: footerHeight + 24 }} />
            </ScrollView>

            {/* CTA Button */}
            <View
                style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 16, 24) }]}
                onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
            >
                {!isSurveyor ? (
                    <View style={{ gap: 10 }}>
                        {isTimedOut ? (
                            <View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', padding: 10, borderRadius: 8, marginBottom: 12 }}>
                                    <MaterialIcons name="warning" size={24} color="#FF9500" style={{ marginRight: 10 }} />
                                    <Text style={{ flex: 1, color: '#E65100', fontSize: 13, lineHeight: 18 }}>
                                        It's been a week since the survey started. Are you satisfied with the progress or do you want admin intervention?
                                    </Text>
                                </View>
                                <View style={{ flexDirection: 'row', gap: 10 }}>
                                    <TouchableOpacity
                                        style={[styles.ctaBtn, { backgroundColor: AppColors.success || '#4CAF50', flex: 1 }]}
                                        onPress={handleMarkSatisfied}
                                        disabled={actionLoading}
                                    >
                                        <Text style={styles.ctaBtnText}>Satisfied</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.ctaBtn, { backgroundColor: '#D32F2F', flex: 1 }]}
                                        onPress={handleEscalateToAdmin}
                                        disabled={actionLoading}
                                    >
                                        <Text style={styles.ctaBtnText}>Escalate</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ) : null}
                        {/* Assigner Actions based on status */}
                        {survey.status === 'pending' && !isTimedOut && (
                            <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: '#E0E0E0' }]} disabled>
                                <ActivityIndicator size="small" color="#666" style={{ marginRight: 8 }} />
                                <Text style={[styles.ctaBtnText, { color: '#666' }]}>Waiting for Location...</Text>
                            </TouchableOpacity>
                        )}
                        {survey.status === 'location_detected' && !isTimedOut && broadcastStatus && broadcastStatus.is_broadcasting && (
                            <View style={{ backgroundColor: '#E3F2FD', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#2196F3', marginRight: 8 }} />
                                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#1565C0' }}>Live Broadcast</Text>
                                    </View>
                                    {secondsLeft !== null && (
                                        <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#1565C0', fontFamily: 'monospace' }}>
                                            {Math.floor(secondsLeft / 60).toString().padStart(2, '0')}:
                                            {(secondsLeft % 60).toString().padStart(2, '0')}
                                        </Text>
                                    )}
                                </View>

                                <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                                    <View style={{ backgroundColor: '#FFF', borderRadius: 8, padding: 12, alignItems: 'center', flex: 1, marginHorizontal: 4 }}>
                                        <Text style={{ fontSize: 11, color: '#666' }}>Radius</Text>
                                        <Text style={{ fontSize: 16, fontWeight: '600', color: '#333' }}>{broadcastStatus.radius_km} km</Text>
                                    </View>
                                    <View style={{ backgroundColor: '#FFF', borderRadius: 8, padding: 12, alignItems: 'center', flex: 1, marginHorizontal: 4 }}>
                                        <Text style={{ fontSize: 11, color: '#666' }}>Notified</Text>
                                        <Text style={{ fontSize: 16, fontWeight: '600', color: '#333' }}>{broadcastStatus.notified_count}</Text>
                                    </View>
                                    <View style={{ backgroundColor: '#FFF', borderRadius: 8, padding: 12, alignItems: 'center', flex: 1, marginHorizontal: 4 }}>
                                        <Text style={{ fontSize: 11, color: '#666' }}>Accepted</Text>
                                        <Text style={{ fontSize: 16, fontWeight: '600', color: '#2E7D32' }}>{broadcastStatus.accepted_count}</Text>
                                    </View>
                                </View>

                                {broadcastStatus.stages && broadcastStatus.stages.length > 0 && (
                                    <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 12 }}>
                                        {broadcastStatus.stages.map((stage, idx) => (
                                            <View
                                                key={idx}
                                                style={{
                                                    width: 10,
                                                    height: 10,
                                                    borderRadius: 5,
                                                    backgroundColor: idx + 1 <= broadcastStatus.attempt ? '#2196F3' : '#E0E0E0',
                                                    marginHorizontal: 4
                                                }}
                                            />
                                        ))}
                                    </View>
                                )}
                            </View>
                        )}
                        {survey.status === 'location_detected' && !isTimedOut && broadcastStatus && !broadcastStatus.is_broadcasting && !broadcastStatus.broadcast_exhausted && (
                            <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: '#E3F2FD' }]} disabled>
                                <ActivityIndicator size="small" color={AppColors.primary} style={{ marginRight: 8 }} />
                                <Text style={[styles.ctaBtnText, { color: AppColors.primary }]}>Finding Surveyors...</Text>
                            </TouchableOpacity>
                        )}
                        {survey.status === 'location_detected' && !isTimedOut && !broadcastStatus && (
                            <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: '#E3F2FD' }]} disabled>
                                <ActivityIndicator size="small" color={AppColors.primary} style={{ marginRight: 8 }} />
                                <Text style={[styles.ctaBtnText, { color: AppColors.primary }]}>Finding Surveyors...</Text>
                            </TouchableOpacity>
                        )}
                        {survey.status === 'pending_assignment' && !isTimedOut && (
                            <TouchableOpacity style={styles.ctaBtn}>
                                <Text style={styles.ctaBtnText}>Assign Surveyor</Text>
                            </TouchableOpacity>
                        )}
                        {/* Pay Now button for 'assigned' status — hidden for direct-assign surveys */}
                        {survey.status === 'assigned' && !isTimedOut && !survey.is_direct_assign && (
                            <TouchableOpacity
                                style={[styles.ctaBtn, { backgroundColor: '#4CAF50' }]}
                                onPress={async () => {
                                    // Check if survey has location
                                    if (!survey.latitude || !survey.longitude) {
                                        Alert.alert(
                                            'Location Required',
                                            'Survey location not found. Please add survey location before making payment.',
                                            [{ text: 'OK' }]
                                        );
                                        return;
                                    }

                                    setActionLoading(true);
                                    try {
                                        const paymentPayload = couponApplied ? { coupon_code: couponCode } : {};
                                        const initRes = await initiatePayment(survey.id, paymentPayload);
                                        const { payment_id, payment_url, final_amount, mock, enc_data, client_code, sp_url } = initRes;

                                        // Edge Case: If final amount is ₹0 (due to coupon), skip payment gateway
                                        if (final_amount === 0 || final_amount === '0') {
                                            // Payment is already marked as completed by backend
                                            Alert.alert('Success', 'Payment completed! Survey started successfully.');
                                            // Refresh survey details to show updated status
                                            setTimeout(() => {
                                                fetchSurveyDetail();
                                            }, 1000);
                                            setActionLoading(false);
                                            return;
                                        }

                                        // Navigate to Payment WebView with SabPaisa params
                                        router.push({
                                            pathname: '/payment',
                                            params: {
                                                payment_url,
                                                payment_id,
                                                survey_id: survey.id,
                                                amount: final_amount,
                                                encData: enc_data,
                                                clientCode: client_code,
                                                spURL: sp_url
                                            }
                                        });

                                    } catch (e) {
                                        console.error(e);
                                        Alert.alert('Error', e.message || 'Failed to initiate payment');
                                    } finally {
                                        setActionLoading(false);
                                    }
                                }}
                                disabled={actionLoading}
                            >
                                {actionLoading ? <ActivityIndicator color="#FFF" /> : (
                                    <>
                                        <MaterialIcons 
                                            name={couponApplied && ((parseFloat(survey.pricing_tier?.price_amount) || 0) - discountAmount) === 0 ? "play-circle-filled" : "payment"} 
                                            size={20} 
                                            color="#FFF" 
                                            style={{ marginRight: 8 }} 
                                        />
                                        <Text style={styles.ctaBtnText}>
                                            {couponApplied && ((parseFloat(survey.pricing_tier?.price_amount) || 0) - discountAmount) === 0
                                                ? 'Start Survey'
                                                : couponApplied
                                                    ? `Pay ₹${((parseFloat(survey.pricing_tier?.price_amount) || 0) - discountAmount).toLocaleString('en-IN')}`
                                                    : `Pay ₹${survey.pricing_tier?.price_amount || '0'}`}
                                        </Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )}
                        {/* Track Surveyor - only for statuses after payment (not 'assigned') */}
                        {/* Track Surveyor - only for statuses after payment (not 'assigned') */}
                        {['in_transit', 'arrived'].includes(survey.status) && !isTimedOut && (
                            <TouchableOpacity
                                style={[styles.ctaBtn, { backgroundColor: '#FF9500' }]}
                                onPress={() => router.push(`/surveyor-tracking/${id}`)}
                            >
                                <MaterialIcons name="location-on" size={20} color="#FFF" style={{ marginRight: 8 }} />
                                <Text style={styles.ctaBtnText}>Track Surveyor</Text>
                            </TouchableOpacity>
                        )}
                        {['disputed', 'not_resolved'].includes(survey.status) && (
                            <TouchableOpacity
                                style={[styles.ctaBtn, { backgroundColor: '#FFB300' }]}
                                onPress={() => router.push(`/dispute/${id}`)}
                            >
                                <MaterialIcons name="gavel" size={20} color="#FFF" style={{ marginRight: 8 }} />
                                <Text style={[styles.ctaBtnText, { color: '#FFF' }]}>View Dispute</Text>
                            </TouchableOpacity>
                        )}
                        {survey.status === 'report_submitted' && !isTimedOut && (
                            <TouchableOpacity
                                style={[styles.ctaBtn, { backgroundColor: AppColors.primary }]}
                                onPress={handleMarkSatisfied}
                                disabled={actionLoading}
                            >
                                {actionLoading ? <ActivityIndicator color="#FFF" /> : (
                                    <>
                                        <MaterialIcons name="check-circle" size={20} color="#FFF" style={{ marginRight: 8 }} />
                                        <Text style={styles.ctaBtnText}>Satisfied</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )}
                        {['visit_completed', 'report_submitted'].includes(survey.status) && !isTimedOut && (
                            <TouchableOpacity
                                style={[styles.ctaBtn, { backgroundColor: '#FFF', borderWidth: 1, borderColor: AppColors.primary }]}
                                onPress={handleChatWithSurveyor}
                            >
                                <Text style={[styles.ctaBtnText, { color: AppColors.primary }]}>Chat with Surveyor</Text>
                            </TouchableOpacity>
                        )}

                    </View>
                ) : (
                    <View style={{ gap: 10 }}>
                        {/* Surveyor Actions */}
                        {/* When status is 'assigned', surveyor must wait for assigner to complete payment */}
                        {['disputed', 'not_resolved'].includes(survey.status) && (
                            <TouchableOpacity
                                style={[styles.ctaBtn, { backgroundColor: '#FFB300' }]}
                                onPress={() => router.push(`/dispute/${id}`)}
                            >
                                <MaterialIcons name="gavel" size={20} color="#FFF" style={{ marginRight: 8 }} />
                                <Text style={[styles.ctaBtnText, { color: '#FFF' }]}>View Dispute</Text>
                            </TouchableOpacity>
                        )}
                        {survey.status === 'assigned' && (
                            <View style={[styles.ctaBtn, { backgroundColor: '#E0E0E0' }]}>
                                <MaterialIcons name="hourglass-empty" size={20} color="#666" style={{ marginRight: 8 }} />
                                <Text style={[styles.ctaBtnText, { color: '#666' }]}>
                                    {survey.is_direct_assign ? 'Waiting for Location...' : 'Waiting for Payment...'}
                                </Text>
                            </View>
                        )}
                        {survey.status === 'in_transit' && !isTimedOut && (
                            <>
                                <TouchableOpacity
                                    style={[styles.ctaBtn, { backgroundColor: '#2196F3' }]}
                                    onPress={() => router.push(`/self-tracking/${id}`)}
                                >
                                    <MaterialIcons name="map" size={20} color="#FFF" style={{ marginRight: 8 }} />
                                    <Text style={styles.ctaBtnText}>View Live Map</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.ctaBtn, { backgroundColor: AppColors.success || '#4CAF50' }]}
                                    onPress={() => {
                                        // Stop location tracking before navigating to inspection
                                        stopTracking();
                                        router.push(`/surveyor-execution/${id}`);
                                    }}
                                >
                                    <Text style={styles.ctaBtnText}>Start Inspection</Text>
                                </TouchableOpacity>
                            </>
                        )}
                        {(survey.status === 'visit_completed' || survey.status === 'report_submitted') && !isTimedOut && (
                            <>
                                {survey.status === 'visit_completed' && (
                                    <TouchableOpacity
                                        style={[styles.ctaBtn, { backgroundColor: '#FF9500' }]}
                                        onPress={() => router.push(`/surveyor-execution/${id}?mode=add_photos`)}
                                    >
                                        <MaterialIcons name="add-a-photo" size={20} color="#FFF" style={{ marginRight: 8 }} />
                                        <Text style={styles.ctaBtnText}>Add More Photos</Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity style={styles.ctaBtn} onPress={handleSubmitReport} disabled={actionLoading}>
                                    {actionLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.ctaBtnText}>{survey.status === 'report_submitted' ? 'Submit Revised Report' : 'Submit Report (PDF)'}</Text>}
                                </TouchableOpacity>
                                {['visit_completed', 'report_submitted'].includes(survey.status) && (
                                    <TouchableOpacity
                                        style={[styles.ctaBtn, { backgroundColor: '#FFF', borderWidth: 1, borderColor: AppColors.primary, marginTop: 10 }]}
                                        onPress={handleChatWithSurveyor}
                                    >
                                        <Text style={[styles.ctaBtnText, { color: AppColors.primary }]}>Chat with Assigner</Text>
                                    </TouchableOpacity>
                                )}
                            </>
                        )}
                    </View>
                )}
            </View>

            {/* Document Preview Modal */}
            <Modal
                visible={!!previewDoc}
                animationType="slide"
                onRequestClose={() => setPreviewDoc(null)}
            >


                <View style={styles.previewModal}>
                    <View style={[styles.previewHeader, { paddingTop: insets.top + 12 }]}>
                        <TouchableOpacity
                            style={styles.previewCloseBtn}
                            onPress={() => setPreviewDoc(null)}
                        >
                            <MaterialIcons name="close" size={24} color="#333" />
                        </TouchableOpacity>
                        <Text style={styles.previewTitle} numberOfLines={1}>
                            {previewDoc?.original_file_name || 'Document Preview'}
                        </Text>
                        <TouchableOpacity onPress={handleDownload} style={styles.previewCloseBtn}>
                            <MaterialIcons name="file-download" size={24} color="#333" />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.previewContent}>
                        {previewDoc?.file_type === 'pdf' ? (
                            <View style={{ flex: 1 }}>
                                <WebView
                                    // v2 §4.4 — a report is fetched with a bearer token, so the Google
                                    // Docs viewer (which fetches the URL from its own servers) cannot
                                    // be used for one. Documents keep the old behaviour.
                                    source={previewDoc.report_url
                                        ? {
                                            uri: previewDoc.report_url,
                                            headers: previewAuthHeaders(previewDoc),
                                        }
                                        : {
                                            uri: Platform.OS === 'ios'
                                                ? getMediaUrl(previewDoc.file_url)
                                                : `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(getMediaUrl(previewDoc.file_url))}`
                                        }}
                                    onHttpError={async ({ nativeEvent }) => {
                                        const url = previewDoc?.report_url;
                                        if (!url) return;
                                        const headers = previewAuthHeaders(previewDoc);
                                        const serverMessage = await fetchReportErrorMessage(url, headers);
                                        setPreviewDoc(null);
                                        Alert.alert(
                                            nativeEvent.statusCode === 402 ? 'Invoice Pending' : 'Unable to open report',
                                            serverMessage || 'This report is not available right now.'
                                        );
                                    }}
                                    style={{ flex: 1 }}
                                    startInLoadingState={true}
                                    renderLoading={() => (
                                        <View style={styles.previewLoading}>
                                            <ActivityIndicator size="large" color={AppColors.primary} />
                                            <Text style={styles.previewLoadingText}>Loading Preview...</Text>
                                        </View>
                                    )}
                                />
                                <View style={styles.pdfFallbackBar}>
                                    <Text style={styles.pdfFallbackText}>Can't see the preview?</Text>
                                    <TouchableOpacity
                                        style={styles.pdfOpenBtn}
                                        onPress={async () => {
                                            // A report URL needs the Authorization header, so handing it
                                            // to the browser would just 401 — download it instead.
                                            if (previewDoc.report_url) {
                                                await handleDownload();
                                                return;
                                            }
                                            const url = getMediaUrl(previewDoc.file_url);
                                            await WebBrowser.openBrowserAsync(url);
                                        }}
                                    >
                                        <Text style={styles.pdfOpenBtnText}>
                                            {previewDoc.report_url ? 'Download PDF' : 'Open in Browser'}
                                        </Text>
                                        <MaterialIcons
                                            name={previewDoc.report_url ? 'file-download' : 'open-in-new'}
                                            size={16}
                                            color="#FFF"
                                        />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ) : (
                            <Image
                                source={{ uri: getMediaUrl(previewDoc?.file_url) }}
                                style={styles.previewImage}
                                contentFit="contain"
                            />
                        )}
                    </View>
                </View>
            </Modal>

            {/* Photo Gallery Modal */}
            <Modal
                visible={photoGalleryVisible}
                animationType="fade"
                statusBarTranslucent
                onRequestClose={() => setPhotoGalleryVisible(false)}
            >
                <View style={styles.galleryModal}>
                    {/* Gallery Header */}
                    <View style={[styles.galleryHeader, { paddingTop: insets.top + 12 }]}>
                        <TouchableOpacity
                            style={styles.galleryHeaderBtn}
                            onPress={() => setPhotoGalleryVisible(false)}
                        >
                            <MaterialIcons name="close" size={24} color="#FFF" />
                        </TouchableOpacity>

                        <View style={styles.galleryHeaderCenter}>
                            <Text style={styles.galleryCounter}>
                                {selectedPhotoIndex + 1} / {getFilteredPhotos().length}
                            </Text>
                            {getFilteredPhotos()[selectedPhotoIndex] && (
                                <View style={styles.galleryPhotoTypeLabel}>
                                    <MaterialIcons
                                        name={
                                            getFilteredPhotos()[selectedPhotoIndex]?.media_type === 'video' ? 'videocam' :
                                                getFilteredPhotos()[selectedPhotoIndex]?.photo_type === 'selfie' ? 'person' :
                                                    getFilteredPhotos()[selectedPhotoIndex]?.photo_type === 'vehicle' ? 'directions-car' : 'camera-alt'
                                        }
                                        size={12}
                                        color="#FFF"
                                    />
                                    <Text style={styles.galleryPhotoTypeLabelText}>
                                        {getFilteredPhotos()[selectedPhotoIndex]?.media_type === 'video'
                                            ? 'Video'
                                            : (getFilteredPhotos()[selectedPhotoIndex]?.photo_type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Photo')}
                                    </Text>
                                </View>
                            )}
                        </View>

                        <View style={styles.galleryHeaderActions}>
                            <TouchableOpacity
                                style={styles.galleryHeaderBtn}
                                onPress={() => handleSharePhoto(getFilteredPhotos()[selectedPhotoIndex])}
                            >
                                <MaterialIcons name="share" size={22} color="#FFF" />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.galleryHeaderBtn}
                                onPress={() => handleDownloadPhoto(getFilteredPhotos()[selectedPhotoIndex])}
                                disabled={isDownloading}
                            >
                                {isDownloading ? (
                                    <ActivityIndicator size="small" color="#FFF" />
                                ) : (
                                    <MaterialIcons name="file-download" size={22} color="#FFF" />
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Full Size Image/Video */}
                    <View style={styles.galleryImageContainer}>
                        {getFilteredPhotos()[selectedPhotoIndex] && (
                            getFilteredPhotos()[selectedPhotoIndex]?.media_type === 'video' ? (
                                // Video Player
                                <Video
                                    source={{ uri: getPhotoUrl(getFilteredPhotos()[selectedPhotoIndex]) }}
                                    style={styles.galleryImage}
                                    useNativeControls
                                    resizeMode={ResizeMode.CONTAIN}
                                    shouldPlay={true}
                                    isLooping={false}
                                />
                            ) : (
                                // Image
                                <Image
                                    source={{ uri: getPhotoUrl(getFilteredPhotos()[selectedPhotoIndex]) }}
                                    style={styles.galleryImage}
                                    contentFit="contain"
                                />
                            )
                        )}

                        {/* Navigation Arrows */}
                        {selectedPhotoIndex > 0 && (
                            <TouchableOpacity
                                style={[styles.galleryNavBtn, styles.galleryNavBtnLeft]}
                                onPress={() => navigatePhoto('prev')}
                            >
                                <MaterialIcons name="chevron-left" size={32} color="#FFF" />
                            </TouchableOpacity>
                        )}
                        {selectedPhotoIndex < getFilteredPhotos().length - 1 && (
                            <TouchableOpacity
                                style={[styles.galleryNavBtn, styles.galleryNavBtnRight]}
                                onPress={() => navigatePhoto('next')}
                            >
                                <MaterialIcons name="chevron-right" size={32} color="#FFF" />
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Bottom Info Bar */}
                    <View style={[styles.galleryBottomBar, { paddingBottom: insets.bottom + 12 }]}>
                        <View style={styles.galleryInfoRow}>
                            <MaterialIcons name="access-time" size={14} color="rgba(255,255,255,0.7)" />
                            <Text style={styles.galleryInfoText}>
                                {(getFilteredPhotos()[selectedPhotoIndex]?.captured_at || getFilteredPhotos()[selectedPhotoIndex]?.created_at)
                                    ? formatCapturedDateTime(getFilteredPhotos()[selectedPhotoIndex].captured_at || getFilteredPhotos()[selectedPhotoIndex].created_at)
                                    : 'Uploaded during inspection'}
                            </Text>
                            {/* Source Type Indicator */}
                            {getFilteredPhotos()[selectedPhotoIndex]?.source_type && (
                                <>
                                    <View style={styles.galleryInfoDivider} />
                                    <MaterialIcons
                                        name={getFilteredPhotos()[selectedPhotoIndex]?.source_type === 'gallery' ? 'photo-library' : 'camera-alt'}
                                        size={14}
                                        color={getFilteredPhotos()[selectedPhotoIndex]?.source_type === 'gallery' ? '#CE93D8' : '#64B5F6'}
                                    />
                                    <Text style={[
                                        styles.galleryInfoText,
                                        { color: getFilteredPhotos()[selectedPhotoIndex]?.source_type === 'gallery' ? '#CE93D8' : '#64B5F6' }
                                    ]}>
                                        {getFilteredPhotos()[selectedPhotoIndex]?.source_type === 'gallery' ? 'From Gallery' : 'Live Camera'}
                                    </Text>
                                </>
                            )}
                        </View>

                        {/* Thumbnail Strip */}
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.galleryThumbnailStrip}
                        >
                            {getFilteredPhotos().map((photo, index) => (
                                <TouchableOpacity
                                    key={photo.id || index}
                                    style={[
                                        styles.galleryThumbnail,
                                        index === selectedPhotoIndex && styles.galleryThumbnailActive
                                    ]}
                                    onPress={() => setSelectedPhotoIndex(index)}
                                >
                                    <Image
                                        source={{ uri: getPhotoUrl(photo) }}
                                        style={styles.galleryThumbnailImage}
                                        contentFit="cover"
                                    />
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Report Submit Modal */}
            <Modal
                visible={reportModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => {
                    setReportModalVisible(false);
                    setReportFile(null);
                }}
            >
                <View style={styles.reportModalOverlay}>
                    <View style={styles.reportModalContent}>
                        <View style={styles.reportModalHeader}>
                            <Text style={styles.reportModalTitle}>Submit Report</Text>
                            <TouchableOpacity onPress={() => {
                                setReportModalVisible(false);
                                setReportFile(null);
                            }}>
                                <MaterialIcons name="close" size={24} color="#333" />
                            </TouchableOpacity>
                        </View>

                        {/* Selected PDF Preview */}
                        <View style={styles.pdfPreviewBox}>
                            <MaterialIcons name="picture-as-pdf" size={48} color="#E53935" />
                            <Text style={styles.pdfFileName} numberOfLines={2}>
                                {reportFile?.name || 'No file selected'}
                            </Text>
                            <Text style={styles.pdfFileSize}>
                                {reportFile?.size ? `${(reportFile.size / 1024).toFixed(1)} KB` : ''}
                            </Text>
                        </View>

                        {/* Notes Input */}
                        <Text style={styles.reportModalLabel}>Notes (Optional)</Text>
                        <TextInput
                            style={styles.reportNotesInput}
                            placeholder="Add any notes about this report..."
                            multiline
                            numberOfLines={3}
                            value={reportNotes}
                            onChangeText={setReportNotes}
                        />

                        {/* Actions */}
                        <View style={styles.reportModalActions}>
                            <TouchableOpacity
                                style={styles.reportModalCancelBtn}
                                onPress={() => {
                                    setReportModalVisible(false);
                                    setReportFile(null);
                                }}
                            >
                                <Text style={styles.reportModalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.reportModalSubmitBtn}
                                onPress={confirmSubmitReport}
                                disabled={actionLoading}
                            >
                                {actionLoading ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <>
                                        <MaterialIcons name="cloud-upload" size={20} color="#FFF" />
                                        <Text style={styles.reportModalSubmitText}>Upload & Submit</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Chat Modal */}
            <ChatModal
                visible={chatVisible}
                onClose={() => setChatVisible(false)}
                surveyId={id}
                isSurveyor={isSurveyor}
                survey={survey}
                userRole={userRole}
            />


        </View>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20
    },
    modalContent: {
        backgroundColor: '#FFF', borderRadius: 16, padding: 20, width: '100%', maxWidth: 340, alignItems: 'center', elevation: 5
    },
    modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#333' },
    modalSubtitle: { fontSize: 13, color: '#666', marginBottom: 12, textAlign: 'center' },
    modalInput: {
        width: '100%', borderWidth: 1, borderColor: '#DDD', borderRadius: 8, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top', marginBottom: 20, backgroundColor: '#F8F8F8'
    },
    modalActions: { flexDirection: 'row', gap: 12, width: '100%' },
    modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
    modalCancelBtn: { backgroundColor: '#F0F0F0' },
    modalConfirmBtn: { backgroundColor: AppColors.primary },
    modalCancelText: { color: '#666', fontWeight: '600' },
    modalConfirmText: { color: '#FFF', fontWeight: '600' },

    // SMS Link Styles
    smsLinkContainer: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
    smsLinkHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    smsLinkLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: AppColors.primary,
    },
    smsLinkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8F8F8',
        borderRadius: 8,
        paddingLeft: 12,
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    smsLinkText: {
        flex: 1,
        fontSize: 12,
        color: '#666',
        paddingVertical: 10,
    },
    smsLinkActions: {
        flexDirection: 'row',
        gap: 4,
        paddingRight: 4,
    },
    smsLinkBtn: {
        width: 36,
        height: 36,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F0F0F0',
    },

    // Map Styles
    mapContainer: {
        marginTop: 12,
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
    },
    map: {
        width: '100%',
        height: 150,
    },
    mapMarker: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    container: {
        flex: 1,
        backgroundColor: '#F5F5F7',
    },
    centered: {
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 16,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    backBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    menuBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    statusLabel: {
        fontSize: 12,
        fontWeight: '600',
    },
    reportsList: {
        gap: 12,
    },
    reportItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#F0F0F0',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    reportIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: AppColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    reportInfo: {
        flex: 1,
    },
    reportTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#333',
    },
    reportSubtitle: {
        fontSize: 12,
        color: '#888',
        marginTop: 2,
    },
    reportNotes: {
        fontSize: 12,
        color: '#666',
        marginTop: 4,
        fontStyle: 'italic',
    },
    // ===== Locked report (v2 §4.4) — metadata stays, only the file is withheld =====
    reportItemLocked: {
        alignItems: 'flex-start',
        backgroundColor: '#FFFDF7',
        borderColor: '#FFE0B2',
    },
    reportIconContainerLocked: {
        backgroundColor: '#FF9500',
    },
    reportLockedReason: {
        fontSize: 12,
        color: '#E65100',
        lineHeight: 17,
        marginTop: 6,
    },
    reportInvoiceLink: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        marginTop: 8,
    },
    reportInvoiceLinkText: {
        fontSize: 13,
        fontWeight: '700',
        color: AppColors.primary,
    },

    infoBtn: {
        padding: 8,
    },
    section: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    subSection: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
    subSectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#666',
        marginBottom: 8,
    },
    listItem: {
        paddingVertical: 6,
    },
    listItemText: {
        fontSize: 13,
        color: '#333',
    },
    addMoreText: {
        fontSize: 13,
        color: AppColors.primary,
        fontWeight: '600',
    },
    infoRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    infoItem: {
        marginBottom: 8,
    },
    infoLabel: {
        fontSize: 11,
        color: '#999',
        marginBottom: 4,
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    instructionsText: {
        fontSize: 14,
        color: '#333',
        lineHeight: 20,
    },
    sessionNoteRow: {
        marginBottom: 12,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#EEE',
    },
    sessionNoteLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: AppColors.primary,
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    sessionGroup: {
        marginBottom: 16,
    },
    sessionGroupHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
        marginTop: 4,
    },
    sessionGroupBadge: {
        fontSize: 11,
        fontWeight: '700',
        color: '#FFF',
        backgroundColor: AppColors.primary,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        overflow: 'hidden',
    },
    sessionGroupCount: {
        fontSize: 11,
        color: '#888',
    },
    mapContainer: {
        height: 120,
        borderRadius: 12,
        overflow: 'hidden',
        marginVertical: 12,
        backgroundColor: '#E8E8E8',
    },
    mapImage: {
        width: '100%',
        height: '100%',
    },
    addressRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        marginTop: 8,
    },
    addressText: {
        flex: 1,
    },
    addressMain: {
        fontSize: 14,
        color: '#333',
        marginBottom: 2,
    },
    addressSub: {
        fontSize: 12,
        color: '#999',
    },
    gmapsLinkBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1A73E8',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        marginTop: 12,
        gap: 8,
    },
    gmapsLinkBtnText: {
        color: '#FFF',
        fontSize: 14,
        fontWeight: '600',
    },
    surveyorRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    surveyorAvatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        marginRight: 12,
    },
    surveyorAvatarPlaceholder: {
        backgroundColor: '#9B89EB',
        justifyContent: 'center',
        alignItems: 'center',
    },
    surveyorAvatarText: {
        color: '#FFF',
        fontSize: 20,
        fontWeight: 'bold',
    },
    surveyorInfo: {
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
    surveyorPhone: {
        fontSize: 13,
        color: '#666',
        marginTop: 2,
    },
    chatBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: AppColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    photoTabs: {
        flexDirection: 'row',
        marginBottom: 12,
    },
    photoTab: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 16,
        marginRight: 8,
        backgroundColor: '#F5F5F5',
    },
    photoTabActive: {
        backgroundColor: '#E8E0FF',
    },
    photoTabText: {
        fontSize: 13,
        color: '#666',
    },
    photoTabTextActive: {
        color: AppColors.primary,
        fontWeight: '600',
    },
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    photoThumb: {
        width: (width - 72) / 4,
        height: (width - 72) / 4,
        borderRadius: 8,
    },
    noPhotos: {
        fontSize: 13,
        color: '#999',
        fontStyle: 'italic',
    },
    viewAllBtn: {
        alignItems: 'center',
        marginTop: 12,
    },
    viewAllText: {
        fontSize: 14,
        color: AppColors.primary,
        fontWeight: '600',
    },
    docGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    docThumbContainer: {
        width: (width - 64 - 12) / 2,
        height: (width - 64 - 12) / 2,
        borderRadius: 12,
        overflow: 'hidden',
    },
    docThumb: {
        width: '100%',
        height: '100%',
        borderRadius: 12,
    },
    pdfThumb: {
        width: '100%',
        height: '100%',
        backgroundColor: '#FFF5F5',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#FFE0E0',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 12,
    },
    pdfThumbText: {
        marginTop: 8,
        fontSize: 11,
        color: '#666',
        textAlign: 'center',
    },
    docItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
    },
    docName: {
        fontSize: 14,
        color: '#333',
        flex: 1,
    },
    noDocuments: {
        fontSize: 13,
        color: '#999',
        fontStyle: 'italic',
    },
    timeline: {
        paddingLeft: 4,
    },
    timelineItem: {
        flexDirection: 'row',
        minHeight: 50,
    },
    timelineLeft: {
        alignItems: 'center',
        marginRight: 12,
    },
    timelineDot: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#E0E0E0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    timelineDotCompleted: {
        backgroundColor: '#4CAF50',
    },
    timelineDotCurrent: {
        backgroundColor: AppColors.primary,
    },
    timelineLine: {
        width: 2,
        flex: 1,
        backgroundColor: '#E0E0E0',
    },
    timelineLineCompleted: {
        backgroundColor: '#4CAF50',
    },
    timelineContent: {
        flex: 1,
        paddingBottom: 16,
    },
    timelineLabel: {
        fontSize: 14,
        color: '#333',
        fontWeight: '500',
    },
    timelineLabelCurrent: {
        color: AppColors.primary,
        fontWeight: '600',
    },
    timelineDate: {
        fontSize: 11,
        color: '#999',
        marginTop: 2,
    },
    // Survey Photos Section
    surveyPhotosSection: {
        marginTop: 8,
    },
    // Photo Filter Tabs
    photoFilterTabs: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
    },
    photoFilterTab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#F5F5F5',
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    photoFilterTabActive: {
        backgroundColor: AppColors.primary,
        borderColor: AppColors.primary,
    },
    photoFilterTabText: {
        fontSize: 12,
        color: '#666',
        fontWeight: '500',
    },
    photoFilterTabTextActive: {
        color: '#FFF',
    },
    surveyPhotosGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    surveyPhotoThumb: {
        width: '31%',
        aspectRatio: 1,
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: '#F0F0F0',
    },
    surveyPhotoImage: {
        width: '100%',
        height: '100%',
    },
    photoTypeBadge: {
        position: 'absolute',
        top: 6,
        left: 6,
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 12,
        width: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    photoTypeBadgeSelfie: {
        backgroundColor: 'rgba(76, 175, 80, 0.9)',
    },
    photoTypeBadgeVehicle: {
        backgroundColor: 'rgba(33, 150, 243, 0.9)',
    },
    photoTypeBadgeText: {
        fontSize: 10,
    },
    photoTapIndicator: {
        position: 'absolute',
        bottom: 6,
        right: 6,
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 12,
        width: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    photoSourceBadge: {
        position: 'absolute',
        top: 6,
        right: 6,
        borderRadius: 12,
        width: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    photoSourceBadgeCamera: {
        backgroundColor: 'rgba(33, 150, 243, 0.9)',
    },
    photoSourceBadgeGallery: {
        backgroundColor: 'rgba(156, 39, 176, 0.9)',
    },
    surveyPhotosInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
    surveyPhotosCount: {
        color: '#888',
        fontSize: 12,
    },
    // Video and Timestamp styles
    videoThumbPlaceholder: {
        backgroundColor: '#E0E0E0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoPlayOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    videoDurationBadge: {
        position: 'absolute',
        bottom: 6,
        left: 6,
        backgroundColor: 'rgba(0,0,0,0.7)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    videoDurationText: {
        color: '#FFF',
        fontSize: 10,
        fontWeight: '600',
    },
    mediaTimestampBadge: {
        position: 'absolute',
        top: 32,
        left: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        backgroundColor: 'rgba(0,0,0,0.7)',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 4,
    },
    mediaTimestampText: {
        color: '#FFF',
        fontSize: 8,
        fontWeight: '500',
    },
    // ===== Final invoice (v2 §3) =====
    billPendingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    billPendingText: {
        flex: 1,
        fontSize: 13,
        color: '#999',
        lineHeight: 18,
    },
    billBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: '#FFF3E0',
    },
    billBadgeSettled: {
        backgroundColor: '#E8F5E9',
    },
    billBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#E65100',
    },
    billBadgeTextSettled: {
        color: '#2E7D32',
    },
    billInvoiceNumber: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        marginTop: -8,
        marginBottom: 12,
    },
    billRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    billLabelCol: {
        flex: 1,
        paddingRight: 12,
    },
    billLabel: {
        fontSize: 14,
        color: '#666',
    },
    billSub: {
        fontSize: 11,
        color: '#999',
        marginTop: 2,
    },
    billValue: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        // Amounts are right-aligned and tabular so the column reads as a column.
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
    billCreditValue: {
        color: '#2E7D32',
    },
    billDivider: {
        height: 1,
        backgroundColor: '#F0F0F0',
        marginBottom: 10,
    },
    billTotalLabel: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    billTotalValue: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1A1A1A',
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
    billBalanceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 6,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
    billBalanceLabel: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    billBalanceValue: {
        fontSize: 20,
        fontWeight: '800',
        color: '#E65100',
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
    billBalanceValueSettled: {
        color: '#2E7D32',
    },
    billNote: {
        fontSize: 12,
        color: '#999',
        lineHeight: 17,
        marginTop: 10,
    },
    payBalanceBtn: {
        marginTop: 14,
        backgroundColor: '#7C5CE6',
        borderRadius: 14,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    payBalanceBtnDisabled: {
        opacity: 0.6,
    },
    payBalanceBtnText: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: '700',
    },
    payBalanceHint: {
        fontSize: 11,
        color: '#999',
        textAlign: 'center',
        lineHeight: 15,
        marginTop: 8,
    },
    pricingRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    pricingItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    pricingLabel: {
        fontSize: 14,
        color: '#666',
        marginRight: 8,
    },
    pricingValue: {
        fontSize: 15,
        fontWeight: '600',
        color: '#333',
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 16,
        paddingBottom: 32,
        backgroundColor: '#FFF',
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
    },
    ctaBtn: {
        backgroundColor: AppColors.primary,
        borderRadius: 24,
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
    },
    ctaBtnText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
    // Document Preview Modal Styles
    previewModal: {
        flex: 1,
        backgroundColor: '#FFF',
    },
    previewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 16,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    previewCloseBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    previewTitle: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        color: '#1A1A1A',
        textAlign: 'center',
        marginHorizontal: 8,
    },
    previewContent: {
        flex: 1,
        backgroundColor: '#F5F5F5',
    },
    previewLoading: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F5F5F5',
    },
    previewLoadingText: {
        marginTop: 12,
        fontSize: 14,
        color: '#666',
    },
    previewImage: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
    pdfFallbackBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        backgroundColor: '#FFF',
        borderTopWidth: 1,
        borderTopColor: '#E0E0E0',
        gap: 12,
    },
    pdfFallbackText: {
        fontSize: 13,
        color: '#666',
    },
    pdfOpenBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: AppColors.primary,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    pdfOpenBtnText: {
        color: '#FFF',
        fontSize: 13,
        fontWeight: '600',
    },
    // Report Submit Modal Styles
    reportModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    reportModalContent: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        paddingBottom: 40,
    },
    reportModalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    reportModalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    pdfPreviewBox: {
        backgroundColor: '#FFF5F5',
        borderRadius: 12,
        padding: 20,
        alignItems: 'center',
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#FFCDD2',
    },
    pdfFileName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginTop: 10,
        textAlign: 'center',
    },
    pdfFileSize: {
        fontSize: 12,
        color: '#666',
        marginTop: 4,
    },
    reportModalLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginBottom: 8,
    },
    reportNotesInput: {
        backgroundColor: '#F5F5F7',
        borderRadius: 8,
        padding: 12,
        minHeight: 80,
        textAlignVertical: 'top',
        borderWidth: 1,
        borderColor: '#E0E0E0',
        marginBottom: 20,
    },
    reportModalActions: {
        flexDirection: 'row',
        gap: 12,
    },
    reportModalCancelBtn: {
        flex: 1,
        padding: 14,
        borderRadius: 12,
        alignItems: 'center',
        backgroundColor: '#F0F0F0',
    },
    reportModalCancelText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#666',
    },
    reportModalSubmitBtn: {
        flex: 2,
        padding: 14,
        borderRadius: 12,
        alignItems: 'center',
        backgroundColor: AppColors.success || '#4CAF50',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
    },
    reportModalSubmitText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFF',
    },
    // Pricing Card Styles
    pricingCard: {
        backgroundColor: '#F8F4FF',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: AppColors.primary + '30',
    },
    pricingRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    pricingItem: {
        flex: 1,
    },
    pricingLabel: {
        fontSize: 12,
        color: '#666',
        marginBottom: 4,
    },
    pricingValue: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    pricingTotal: {
        borderTopWidth: 1,
        borderTopColor: AppColors.primary + '30',
        paddingTop: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    pricingTotalLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#666',
    },
    pricingTotalValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: AppColors.primary,
    },
    // Assigner Action Styles
    assignerActionsCard: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        marginHorizontal: 16,
        marginVertical: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
    },
    assignerActionsTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1A1A1A',
        marginBottom: 12,
    },
    assignerActionsRow: {
        flexDirection: 'row',
        gap: 12,
    },
    assignerActionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
    },
    satisfiedBtn: {
        backgroundColor: '#4CAF50',
    },
    chatActionBtn: {
        backgroundColor: AppColors.primary,
    },
    assignerActionBtnText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#FFF',
    },
    // New Payment Card Styles (Improved UI)
    paymentCardContainer: {
        marginHorizontal: 16,
        marginVertical: 12,
        borderRadius: 20,
        backgroundColor: '#FFF',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 6,
    },
    paymentCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#6C63FF',
        paddingVertical: 20,
        paddingHorizontal: 20,
        gap: 16,
    },
    paymentIconContainer: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    paymentHeaderText: {
        flex: 1,
    },
    paymentCardTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#FFF',
        marginBottom: 4,
    },
    paymentCardSubtitle: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.85)',
    },
    paymentCardBody: {
        padding: 20,
    },
    paymentPricingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8F9FF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    paymentPricingItem: {
        flex: 1,
        alignItems: 'center',
    },
    paymentPricingLabel: {
        fontSize: 12,
        color: '#666',
        marginBottom: 6,
    },
    paymentPricingValue: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    paymentPricingDivider: {
        width: 1,
        height: 40,
        backgroundColor: '#E0E0E0',
        marginHorizontal: 8,
    },
    paymentAmountContainer: {
        alignItems: 'center',
        paddingVertical: 16,
        borderTopWidth: 1,
        borderTopColor: '#F0F0F0',
        marginBottom: 16,
    },
    paymentAmountLabel: {
        fontSize: 13,
        color: '#666',
        marginBottom: 8,
    },
    paymentAmountValue: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#4CAF50',
    },
    paymentNote: {
        fontSize: 13,
        color: '#888',
        textAlign: 'center',
        lineHeight: 20,
    },
    // All Pricing Tiers Styles
    allPricingContainer: {
        gap: 12,
    },
    currentDistanceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: AppColors.primary + '15',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        gap: 8,
        marginBottom: 4,
    },
    currentDistanceText: {
        fontSize: 14,
        color: '#444',
    },
    currentDistanceValue: {
        fontWeight: '700',
        color: AppColors.primary,
    },
    tierRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#F5F5F5',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    tierRowActive: {
        backgroundColor: AppColors.primary + '15',
        borderColor: AppColors.primary,
    },
    tierInfo: {
        flex: 1,
    },
    tierName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#333',
        marginBottom: 2,
    },
    tierNameActive: {
        color: AppColors.primary,
    },
    tierDistance: {
        fontSize: 12,
        color: '#888',
    },
    tierPrice: {
        alignItems: 'flex-end',
    },
    tierPriceValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    tierPriceActive: {
        color: AppColors.primary,
    },
    currentBadge: {
        backgroundColor: '#4CAF50',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        marginTop: 4,
    },
    currentBadgeText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#FFF',
    },
    // Pricing Preview Styles
    pricingPreviewCard: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
    },
    pricingPreviewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
    },
    pricingPreviewTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    pricingPreviewRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    pricingPreviewDistance: {
        fontSize: 15,
        color: '#444',
    },
    pricingPreviewAmount: {
        fontSize: 16,
        fontWeight: '600',
        color: '#666',
    },
    // Photo Gallery Modal Styles
    galleryModal: {
        flex: 1,
        backgroundColor: '#000',
    },
    galleryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        paddingBottom: 12,
        backgroundColor: 'rgba(0,0,0,0.8)',
    },
    galleryHeaderBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    galleryHeaderCenter: {
        flex: 1,
        alignItems: 'center',
    },
    galleryCounter: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
    galleryPhotoTypeLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 4,
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    galleryPhotoTypeLabelText: {
        color: '#FFF',
        fontSize: 11,
        fontWeight: '500',
    },
    galleryHeaderActions: {
        flexDirection: 'row',
        gap: 4,
    },
    galleryImageContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    galleryImage: {
        width: '100%',
        height: '100%',
    },
    galleryNavBtn: {
        position: 'absolute',
        top: '50%',
        marginTop: -28,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: 'rgba(255,255,255,0.15)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    galleryNavBtnLeft: {
        left: 12,
    },
    galleryNavBtnRight: {
        right: 12,
    },
    galleryBottomBar: {
        backgroundColor: 'rgba(0,0,0,0.85)',
        paddingTop: 12,
    },
    galleryInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginBottom: 12,
    },
    galleryInfoText: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 12,
    },
    galleryInfoDivider: {
        width: 1,
        height: 12,
        backgroundColor: 'rgba(255,255,255,0.3)',
        marginHorizontal: 4,
    },
    galleryThumbnailStrip: {
        paddingHorizontal: 16,
        gap: 8,
    },
    galleryThumbnail: {
        width: 56,
        height: 56,
        borderRadius: 8,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'transparent',
    },
    galleryThumbnailActive: {
        borderColor: '#FFF',
    },
    galleryThumbnailImage: {
        width: '100%',
        height: '100%',
    },
    // Locked Section Styles
    lockBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF8E1',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    lockBadgeText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#FF9500',
    },
    lockedContent: {
        backgroundColor: '#F5F5F5',
        borderRadius: 12,
        padding: 24,
        minHeight: 100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    lockedOverlay: {
        alignItems: 'center',
        gap: 8,
    },
    lockedText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#FF9500',
        textAlign: 'center',
    },
    lockedSubtext: {
        fontSize: 12,
        color: '#888',
        textAlign: 'center',
    },

});
