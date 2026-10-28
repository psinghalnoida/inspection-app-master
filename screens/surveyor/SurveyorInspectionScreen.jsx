import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Video } from 'expo-av';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';
import { AppColors } from '../../constants/theme';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import {
    compressImage,
    formatLocationForWatermark,
    formatTimestampForWatermark,
    processVideoForUpload,
    watermarkStyles
} from '../../lib/mediaUtils';
import surveyorService from '../../lib/surveyorService';
import { getMediaUrl } from '../../constants/config';
import {
    clearInspectionDraft,
    deleteDraftFile,
    getInspectionDraft,
    persistDraftMedia,
    saveInspectionDraft
} from '../../lib/offlineDb';

const STEPS = {
    SELFIE: 1,
    MEDIA: 2,
    NOTES: 3,
    REVIEW: 4
};

const STEP_LABELS = {
    [STEPS.SELFIE]: 'Selfie',
    [STEPS.MEDIA]: 'Photos & Videos',
    [STEPS.NOTES]: 'Notes',
    [STEPS.REVIEW]: 'Review'
};

export default function SurveyorInspectionScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { id, mode } = useLocalSearchParams();
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [processingMessage, setProcessingMessage] = useState('');
    const isAddPhotosMode = mode === 'add_photos';
    // Mode key under which the in-progress draft is keyed in temp storage.
    // Lets a fresh-visit draft and an add-more-photos draft coexist for the
    // same survey without overwriting each other.
    const draftMode = isAddPhotosMode ? 'add_photos' : 'start';
    // Gates the auto-save effect so the empty initial state doesn't clobber
    // a draft that's still being read from SQLite.
    const [draftLoaded, setDraftLoaded] = useState(false);

    // Step state (1-4)
    const [currentStep, setCurrentStep] = useState(isAddPhotosMode ? STEPS.MEDIA : STEPS.SELFIE);

    // Local photos (not uploaded yet) - stored as { uri, source: 'camera' | 'gallery', capturedAt, watermarked }
    const [localPhotos, setLocalPhotos] = useState([]);
    const [localSelfie, setLocalSelfie] = useState(null); // { uri, capturedAt, watermarked }

    // Local videos (not uploaded yet) - stored as { uri, source: 'camera' | 'gallery', capturedAt, duration }
    const [localVideos, setLocalVideos] = useState([]);

    // Already uploaded photos from server
    const [uploadedPhotos, setUploadedPhotos] = useState([]);
    // Already uploaded videos from server
    const [uploadedVideos, setUploadedVideos] = useState([]);

    const [notes, setNotes] = useState('');
    const [location, setLocation] = useState(null);

    // Upload progress state: { selfie: { status, progress }, photos: [{status, progress}], videos: [{status, progress}] }
    const [uploadProgress, setUploadProgress] = useState({
        isUploading: false,
        currentItem: '',
        selfie: { status: 'pending', progress: 0 },
        photos: [],
        videos: [],
        notes: { status: 'pending' },
        completing: { status: 'pending' }
    });

    // Media type tab: 'photos' or 'videos'
    const [mediaTab, setMediaTab] = useState('photos');

    // Network status for offline detection
    const { isConnected, isInternetReachable } = useNetworkStatus();
    const isOnline = isConnected && isInternetReachable;

    // Refs for watermark capture
    const selfieViewShotRef = useRef(null);
    const photoViewShotRefs = useRef({});

    const [tempImageForWatermark, setTempImageForWatermark] = useState(null);

    // Full-screen preview modal state
    const [previewModal, setPreviewModal] = useState({
        visible: false,
        type: null, // 'image' or 'video'
        uri: null,
    });

    const openPreview = (type, uri) => {
        setPreviewModal({ visible: true, type, uri });
    };

    const closePreview = () => {
        setPreviewModal({ visible: false, type: null, uri: null });
    };

    // Address for review display
    const [address, setAddress] = useState('');

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission to access location was denied');
                return;
            }
            let loc = await Location.getCurrentPositionAsync({});
            setLocation(loc.coords);

            // Get full address using reverse geocoding
            try {
                const addresses = await Location.reverseGeocodeAsync({
                    latitude: loc.coords.latitude,
                    longitude: loc.coords.longitude
                });
                if (addresses && addresses.length > 0) {
                    const addr = addresses[0];
                    const parts = [];
                    if (addr.name && addr.name !== addr.street) parts.push(addr.name);
                    if (addr.street) parts.push(addr.street);
                    if (addr.district) parts.push(addr.district);
                    if (addr.city) parts.push(addr.city);
                    if (addr.region) parts.push(addr.region);
                    setAddress(parts.join(', '));
                }
            } catch (error) {
                console.log('Reverse geocoding failed:', error);
            }
        })();
    }, []);

    // Session number for this entry. First visit = 1; each "Add More Media"
    // re-entry should bump to max(existing) + 1 so new media is grouped
    // separately from the original visit's. Resolved once existing media is
    // fetched (or starts at 1 for fresh visits).
    const [sessionNumber, setSessionNumber] = useState(isAddPhotosMode ? null : 1);

    // Load existing uploaded photos and videos. surveyorService.getPhotos
    // unwraps the API envelope and returns the raw array (or sometimes the
    // full {success,data} object on cache fallback), so we accept both shapes.
    const loadMedia = async () => {
        try {
            const res = await surveyorService.getPhotos(id);
            const allMedia = Array.isArray(res) ? res : (res?.data || []);
            setUploadedPhotos(allMedia.filter(m => m.media_type !== 'video'));
            setUploadedVideos(allMedia.filter(m => m.media_type === 'video'));

            if (isAddPhotosMode) {
                const maxSession = allMedia.reduce(
                    (max, m) => Math.max(max, Number(m.session_number) || 1),
                    0
                );
                setSessionNumber(maxSession + 1);
            }
        } catch (err) {
            console.log(err);
            // If we couldn't load existing media in Add-More mode, fall back
            // to session 2 so the user isn't blocked. Worst case: it still
            // groups separately from session 1.
            if (isAddPhotosMode) setSessionNumber(prev => prev || 2);
        }
    };

    useEffect(() => {
        loadMedia();
    }, [id]);

    // Restore in-progress draft (selfie/photos/videos/notes/step) from temp
    // storage so the surveyor doesn't lose work if they accidentally back
    // out of the screen and reopen it.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!id) return;
            try {
                const draft = await getInspectionDraft(id, draftMode);
                if (!cancelled && draft) {
                    if (draft.selfie) setLocalSelfie(draft.selfie);
                    if (Array.isArray(draft.photos)) setLocalPhotos(draft.photos);
                    if (Array.isArray(draft.videos)) setLocalVideos(draft.videos);
                    if (typeof draft.notes === 'string') setNotes(draft.notes);
                    if (draft.currentStep) setCurrentStep(draft.currentStep);
                }
            } finally {
                if (!cancelled) setDraftLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [id, draftMode]);

    // Persist draft on every change once the initial load is done. We write
    // the whole snapshot — small enough that debouncing isn't worth the
    // complexity, and SQLite handles the throughput easily.
    useEffect(() => {
        if (!id || !draftLoaded) return;
        const hasContent = !!localSelfie || localPhotos.length > 0 || localVideos.length > 0 || (notes && notes.length > 0);
        if (!hasContent) {
            // Nothing worth persisting — also drop any stale row so we don't
            // leave an empty draft hanging around after the user removes
            // everything they had captured.
            clearInspectionDraft(id, draftMode);
            return;
        }
        saveInspectionDraft(id, draftMode, {
            selfie: localSelfie,
            photos: localPhotos,
            videos: localVideos,
            notes,
            currentStep,
        });
    }, [id, draftMode, draftLoaded, localSelfie, localPhotos, localVideos, notes, currentStep]);

    // Capture watermarked image from ViewShot
    const captureWatermarkedImage = async (viewShotRef, originalUri) => {
        try {
            if (viewShotRef && viewShotRef.current) {
                const watermarkedUri = await viewShotRef.current.capture();
                // Compress the watermarked image
                const compressedUri = await compressImage(watermarkedUri, 300);
                return { uri: compressedUri, watermarked: true };
            }
        } catch (error) {
            console.error('Watermark capture failed:', error);
        }
        // Fallback: compress without watermark
        const compressedUri = await compressImage(originalUri, 300);
        return { uri: compressedUri, watermarked: false };
    };

    const takeSelfie = async () => {
        // Request camera permission
        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        if (!cameraPermission.granted) {
            Alert.alert('Permission Required', 'Please allow camera access to take a selfie.');
            return;
        }

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: false,
            cameraType: 'front',
            quality: 0.9,
        });

        if (!result.canceled) {
            setProcessing(true);
            setProcessingMessage('Processing selfie...');
            try {
                const originalUri = result.assets[0].uri;
                const timestamp = formatTimestampForWatermark();
                const locationText = await formatLocationForWatermark(location);

                // Set temp image for watermark rendering
                setTempImageForWatermark({
                    uri: originalUri,
                    timestamp,
                    location: locationText,
                    type: 'selfie'
                });

                // Wait for ViewShot to render then capture
                setTimeout(async () => {
                    const { uri: processedUri, watermarked } = await captureWatermarkedImage(
                        selfieViewShotRef,
                        originalUri
                    );

                    const persistedUri = await persistDraftMedia(id, draftMode, processedUri, 'selfie')
                        .catch(() => processedUri);

                    setLocalSelfie(prev => {
                        if (prev?.uri) deleteDraftFile(prev.uri);
                        return {
                            uri: persistedUri,
                            capturedAt: new Date().toISOString(),
                            watermarked
                        };
                    });

                    setTempImageForWatermark(null);
                    setProcessing(false);
                    setProcessingMessage('');
                }, 500);
            } catch (error) {
                console.error('Selfie processing error:', error);
                setProcessing(false);
                setProcessingMessage('');
            }
        }
    };

    const takePhoto = async () => {
        // Request camera permission
        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        if (!cameraPermission.granted) {
            Alert.alert('Permission Required', 'Please allow camera access to take photos.');
            return;
        }

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.9,
        });

        if (!result.canceled) {
            setProcessing(true);
            setProcessingMessage('Adding watermark & compressing...');
            try {
                const originalUri = result.assets[0].uri;
                const timestamp = formatTimestampForWatermark();
                const locationText = await formatLocationForWatermark(location);
                const photoId = `photo_${Date.now()}`;

                // Set temp image for watermark rendering
                setTempImageForWatermark({
                    uri: originalUri,
                    timestamp,
                    location: locationText,
                    type: 'photo',
                    id: photoId
                });

                // Wait for ViewShot to render then capture
                setTimeout(async () => {
                    const ref = photoViewShotRefs.current[photoId];
                    const { uri: processedUri, watermarked } = await captureWatermarkedImage(
                        ref ? { current: ref } : null,
                        originalUri
                    );

                    const persistedUri = await persistDraftMedia(id, draftMode, processedUri, 'photo')
                        .catch(() => processedUri);

                    setLocalPhotos(prev => [...prev, {
                        uri: persistedUri,
                        source: 'camera',
                        capturedAt: new Date().toISOString(),
                        watermarked
                    }]);

                    setTempImageForWatermark(null);
                    setProcessing(false);
                    setProcessingMessage('');
                }, 500);
            } catch (error) {
                console.error('Photo processing error:', error);
                setProcessing(false);
                setProcessingMessage('');
            }
        }
    };

    const pickGalleryPhoto = async () => {
        // Uses the Android system photo picker (no media permissions required).
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.9,
            allowsMultipleSelection: true
        });

        if (!result.canceled) {
            setProcessing(true);
            setProcessingMessage(`Compressing ${result.assets.length} photo(s)...`);
            try {
                const processedPhotos = [];
                for (let i = 0; i < result.assets.length; i++) {
                    setProcessingMessage(`Compressing photo ${i + 1}/${result.assets.length}...`);
                    const asset = result.assets[i];
                    // Gallery photos: compress only, no watermark
                    const compressedUri = await compressImage(asset.uri, 300);
                    const persistedUri = await persistDraftMedia(id, draftMode, compressedUri, 'photo')
                        .catch(() => compressedUri);
                    processedPhotos.push({
                        uri: persistedUri,
                        source: 'gallery',
                        capturedAt: new Date().toISOString(),
                        watermarked: false
                    });
                }
                setLocalPhotos(prev => [...prev, ...processedPhotos]);
            } catch (error) {
                console.error('Gallery photo processing error:', error);
            }
            setProcessing(false);
            setProcessingMessage('');
        }
    };

    const recordVideo = async () => {
        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        if (!cameraPermission.granted) {
            Alert.alert('Permission Required', 'Please allow camera access to record videos.');
            return;
        }

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['videos'],
            quality: 0.7,
            videoMaxDuration: 60,
        });

        if (!result.canceled) {
            setProcessing(true);
            setProcessingMessage('Adding watermark & compressing...');
            try {
                const asset = result.assets[0];
                let location = null;
                try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status === 'granted') {
                        const pos = await Location.getCurrentPositionAsync({
                            accuracy: Location.Accuracy.Balanced,
                        });
                        location = pos.coords;
                    }
                } catch (e) {
                    console.warn('Location for video watermark:', e?.message);
                }
                const processedUri = await processVideoForUpload(
                    asset.uri,
                    'camera',
                    location
                );
                const persistedUri = await persistDraftMedia(id, draftMode, processedUri, 'video')
                    .catch(() => processedUri);
                setLocalVideos(prev => [...prev, {
                    uri: persistedUri,
                    source: 'camera',
                    capturedAt: new Date().toISOString(),
                    duration: asset.duration ? Math.round(asset.duration / 1000) : 0
                }]);
            } catch (error) {
                console.error('Video processing error:', error);
            }
            setProcessing(false);
            setProcessingMessage('');
        }
    };

    const pickGalleryVideo = async () => {
        // Uses the Android system photo picker (no media permissions required).
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['videos'],
            quality: 0.7,
            allowsMultipleSelection: true
        });

        if (!result.canceled) {
            setProcessing(true);
            setProcessingMessage(`Compressing ${result.assets.length} video(s)...`);
            try {
                const processedVideos = [];
                for (let i = 0; i < result.assets.length; i++) {
                    setProcessingMessage(`Compressing video ${i + 1}/${result.assets.length}...`);
                    const asset = result.assets[i];
                    const processedUri = await processVideoForUpload(asset.uri, 'gallery');
                    const persistedUri = await persistDraftMedia(id, draftMode, processedUri, 'video')
                        .catch(() => processedUri);
                    processedVideos.push({
                        uri: persistedUri,
                        source: 'gallery',
                        capturedAt: new Date().toISOString(),
                        duration: asset.duration ? Math.round(asset.duration / 1000) : 0
                    });
                }
                setLocalVideos(prev => [...prev, ...processedVideos]);
            } catch (error) {
                console.error('Gallery video processing error:', error);
            }
            setProcessing(false);
            setProcessingMessage('');
        }
    };

    const removeLocalPhoto = (index) => {
        setLocalPhotos(prev => {
            const target = prev[index];
            if (target?.uri) deleteDraftFile(target.uri);
            return prev.filter((_, i) => i !== index);
        });
    };

    const removeLocalVideo = (index) => {
        setLocalVideos(prev => {
            const target = prev[index];
            if (target?.uri) deleteDraftFile(target.uri);
            return prev.filter((_, i) => i !== index);
        });
    };

    const removeSelfie = () => {
        setLocalSelfie(prev => {
            if (prev?.uri) deleteDraftFile(prev.uri);
            return null;
        });
    };

    const formatDuration = (seconds) => {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleCompleteVisit = async () => {
        Alert.alert('Confirm', isAddPhotosMode ? 'Upload new photos/videos?' : 'Upload all media and complete the visit?', [
            { text: 'Cancel' },
            {
                text: isAddPhotosMode ? 'Upload' : 'Complete', onPress: async () => {
                    // In Add-More-Media mode the session number is resolved from
                    // existing media; if the fetch hasn't completed yet, abort
                    // rather than risk merging into the previous session.
                    if (isAddPhotosMode && !sessionNumber) {
                        Alert.alert('Please wait', 'Loading existing media…');
                        return;
                    }
                    setLoading(true);

                    // Initialize upload progress
                    setUploadProgress({
                        isUploading: true,
                        currentItem: 'Preparing upload...',
                        selfie: { status: localSelfie ? 'pending' : 'skipped', progress: 0 },
                        photos: localPhotos.map(() => ({ status: 'pending', progress: 0 })),
                        videos: localVideos.map(() => ({ status: 'pending', progress: 0 })),
                        notes: { status: notes ? 'pending' : 'skipped' },
                        completing: { status: 'pending' }
                    });

                    let hasQueued = false;

                    try {
                        // 1. Upload selfie if local
                        if (localSelfie) {
                            setUploadProgress(prev => ({
                                ...prev,
                                currentItem: 'Uploading selfie...',
                                selfie: { status: 'uploading', progress: 30 }
                            }));

                            const result = await surveyorService.uploadSelfieOfflineAware(
                                id,
                                localSelfie.uri,
                                location?.latitude?.toString(),
                                location?.longitude?.toString(),
                                localSelfie.capturedAt,
                                sessionNumber || 1
                            );

                            setUploadProgress(prev => ({
                                ...prev,
                                selfie: { status: result.queued ? 'queued' : 'done', progress: 100 }
                            }));
                            if (result.queued) hasQueued = true;
                        }

                        // 2. Upload all local photos one by one
                        for (let i = 0; i < localPhotos.length; i++) {
                            const photo = localPhotos[i];

                            setUploadProgress(prev => ({
                                ...prev,
                                currentItem: `Uploading photo ${i + 1}/${localPhotos.length}...`,
                                photos: prev.photos.map((p, idx) =>
                                    idx === i ? { status: 'uploading', progress: 30 } : p
                                )
                            }));

                            const result = await surveyorService.uploadPhotosOfflineAware(
                                id,
                                [{
                                    uri: photo.uri,
                                    source: photo.source,
                                    capturedAt: photo.capturedAt
                                }],
                                location?.latitude?.toString(),
                                location?.longitude?.toString(),
                                undefined,
                                sessionNumber || 1
                            );

                            setUploadProgress(prev => ({
                                ...prev,
                                photos: prev.photos.map((p, idx) =>
                                    idx === i ? { status: result.queued ? 'queued' : 'done', progress: 100 } : p
                                )
                            }));
                            if (result.queued) hasQueued = true;
                        }

                        // 3. Upload all local videos one by one
                        for (let i = 0; i < localVideos.length; i++) {
                            const video = localVideos[i];

                            setUploadProgress(prev => ({
                                ...prev,
                                currentItem: `Uploading video ${i + 1}/${localVideos.length}...`,
                                videos: prev.videos.map((v, idx) =>
                                    idx === i ? { status: 'uploading', progress: 30 } : v
                                )
                            }));

                            const result = await surveyorService.uploadVideosOfflineAware(
                                id,
                                [{
                                    uri: video.uri,
                                    source: video.source,
                                    capturedAt: video.capturedAt,
                                    duration: video.duration
                                }],
                                location?.latitude?.toString(),
                                location?.longitude?.toString(),
                                undefined,
                                sessionNumber || 1
                            );

                            setUploadProgress(prev => ({
                                ...prev,
                                videos: prev.videos.map((v, idx) =>
                                    idx === i ? { status: result.queued ? 'queued' : 'done', progress: 100 } : v
                                )
                            }));
                            if (result.queued) hasQueued = true;
                        }

                        // 4. Save notes for this session (queues if offline so re-visit
                        // remarks aren't silently dropped, and tagged with session_number
                        // so they don't overwrite the previous visit's notes).
                        if (notes) {
                            setUploadProgress(prev => ({
                                ...prev,
                                currentItem: 'Saving notes...',
                                notes: { status: 'uploading' }
                            }));
                            const notesResult = await surveyorService.updateNotesOfflineAware(
                                id,
                                notes,
                                sessionNumber || 1
                            );
                            setUploadProgress(prev => ({
                                ...prev,
                                notes: { status: notesResult.queued ? 'queued' : 'done' }
                            }));
                            if (notesResult.queued) hasQueued = true;
                        }

                        // 5. Complete the visit
                        if (isOnline && !hasQueued) {
                            setUploadProgress(prev => ({
                                ...prev,
                                currentItem: 'Completing visit...',
                                completing: { status: 'uploading' }
                            }));
                            await surveyorService.completeVisit(id);
                            setUploadProgress(prev => ({
                                ...prev,
                                completing: { status: 'done' }
                            }));
                        }

                        setUploadProgress(prev => ({
                            ...prev,
                            isUploading: false,
                            currentItem: 'Complete!'
                        }));

                        // Draft is no longer needed — files are either uploaded
                        // or queued in pending_uploads, which owns its own copies.
                        await clearInspectionDraft(id, draftMode).catch(() => { });

                        // Show success message
                        setTimeout(() => {
                            if (hasQueued) {
                                Alert.alert(
                                    'Saved Offline',
                                    'Your media has been saved and will automatically upload when you\'re back online.',
                                    [{ text: 'OK', onPress: () => router.replace(`/survey-detail/${id}`) }]
                                );
                            } else {
                                Alert.alert('Success', isAddPhotosMode ? 'Media uploaded successfully!' : 'Visit completed successfully!', [
                                    { text: 'OK', onPress: () => router.replace(`/survey-detail/${id}`) }
                                ]);
                            }
                        }, 500);
                    } catch (error) {
                        setUploadProgress(prev => ({ ...prev, isUploading: false }));
                        Alert.alert('Error', error.message || 'Failed to complete task');
                    } finally {
                        setLoading(false);
                    }
                }
            }
        ]);
    };

    // Check if we have a selfie (local or uploaded)
    const existingSelfie = uploadedPhotos.find(p => p.photo_type === 'selfie');
    const hasSelfie = localSelfie || existingSelfie;

    // Check total photos and videos
    const existingPhotos = uploadedPhotos.filter(p => p.photo_type !== 'selfie');
    const totalPhotos = localPhotos.length + existingPhotos.length;
    const totalVideos = localVideos.length + uploadedVideos.length;
    const totalMedia = totalPhotos + totalVideos;

    // Step navigation helpers
    const canGoToNextStep = () => {
        switch (currentStep) {
            case STEPS.SELFIE:
                return hasSelfie;
            case STEPS.MEDIA:
                return totalMedia > 0;
            case STEPS.NOTES:
                return true;
            case STEPS.REVIEW:
                return false; // No next step
            default:
                return true;
        }
    };

    const goToNextStep = () => {
        if (currentStep < STEPS.REVIEW && canGoToNextStep()) {
            setCurrentStep(prev => prev + 1);
        }
    };

    const goToPrevStep = () => {
        if (currentStep > (isAddPhotosMode ? STEPS.MEDIA : STEPS.SELFIE)) {
            setCurrentStep(prev => prev - 1);
        }
    };

    // Render step progress indicator
    const renderStepIndicator = () => {
        const steps = isAddPhotosMode
            ? [STEPS.MEDIA, STEPS.NOTES, STEPS.REVIEW]
            : [STEPS.SELFIE, STEPS.MEDIA, STEPS.NOTES, STEPS.REVIEW];

        return (
            <View style={styles.stepIndicator}>
                {steps.map((step, index) => (
                    <View key={step} style={styles.stepItem}>
                        <View style={[
                            styles.stepCircle,
                            currentStep >= step && styles.stepCircleActive,
                            currentStep === step && styles.stepCircleCurrent
                        ]}>
                            {currentStep > step ? (
                                <MaterialIcons name="check" size={16} color="#FFF" />
                            ) : (
                                <Text style={[
                                    styles.stepNumber,
                                    currentStep >= step && styles.stepNumberActive
                                ]}>
                                    {isAddPhotosMode ? index + 1 : step}
                                </Text>
                            )}
                        </View>
                        <Text style={[
                            styles.stepLabel,
                            currentStep >= step && styles.stepLabelActive
                        ]}>
                            {STEP_LABELS[step]}
                        </Text>
                        {index < steps.length - 1 && (
                            <View style={[
                                styles.stepLine,
                                currentStep > step && styles.stepLineActive
                            ]} />
                        )}
                    </View>
                ))}
            </View>
        );
    };

    // Render selfie step - Full screen minimal UI
    const renderSelfieStep = () => (
        <View style={styles.fullScreenStep}>
            {/* Top - Title & Description */}
            <View style={styles.stepHeader}>
                <Text style={styles.stepTitle}>Take Your Selfie</Text>
                <Text style={styles.stepDescription}>
                    Verify your presence at the inspection location
                </Text>
            </View>

            {/* Center - Selfie Area */}
            <View style={styles.stepContent}>
                {localSelfie ? (
                    <View style={styles.selfiePreviewContainer}>
                        <TouchableOpacity
                            onPress={() => openPreview('image', localSelfie.uri)}
                            activeOpacity={0.9}
                        >
                            <Image source={{ uri: localSelfie.uri }} style={styles.selfiePreviewImage} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.retakeBtn} onPress={removeSelfie}>
                            <MaterialIcons name="refresh" size={20} color={AppColors.primary} />
                            <Text style={styles.retakeBtnText}>Retake</Text>
                        </TouchableOpacity>
                    </View>
                ) : existingSelfie ? (
                    <View style={styles.selfiePreviewContainer}>
                        <TouchableOpacity
                            onPress={() => openPreview('image', getMediaUrl(existingSelfie.file_url))}
                            activeOpacity={0.9}
                        >
                            <Image
                                source={{ uri: getMediaUrl(existingSelfie.file_url) }}
                                style={styles.selfiePreviewImage}
                            />
                        </TouchableOpacity>
                        <View style={styles.uploadedIndicator}>
                            <MaterialIcons name="check-circle" size={20} color="#4CAF50" />
                            <Text style={styles.uploadedIndicatorText}>Uploaded</Text>
                        </View>
                    </View>
                ) : (
                    <View style={styles.selfiePlaceholder}>
                        <View style={styles.selfiePlaceholderCircle}>
                            <MaterialIcons name="person" size={80} color="#DDD" />
                        </View>
                        <Text style={styles.selfiePlaceholderText}>
                            Your selfie will appear here
                        </Text>
                    </View>
                )}
            </View>

            {/* Bottom - Action Button */}
            {!localSelfie && !existingSelfie && (
                <View style={styles.stepActionArea}>
                    <TouchableOpacity style={styles.mainActionBtn} onPress={takeSelfie}>
                        <MaterialIcons name="camera-front" size={28} color="#FFF" />
                        <Text style={styles.mainActionBtnText}>Take Selfie</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepHint}>
                        <MaterialIcons name="access-time" size={12} color="#999" /> Timestamp & location will be added automatically
                    </Text>
                </View>
            )}
        </View>
    );

    // Render media step (photos/videos) - Full screen minimal UI
    const renderMediaStep = () => (
        <View style={styles.fullScreenStep}>
            {/* Top - Title & Description */}
            <View style={styles.stepHeader}>
                <Text style={styles.stepTitle}>Capture Media</Text>
                <Text style={styles.stepDescription}>
                    Add photos and videos of the vehicle inspection
                </Text>
            </View>

            {/* Media Type Toggle - Centered Pill */}
            <View style={styles.mediaToggleContainer}>
                <View style={styles.mediaTogglePill}>
                    <TouchableOpacity
                        style={[styles.mediaToggleItem, mediaTab === 'photos' && styles.mediaToggleItemActive]}
                        onPress={() => setMediaTab('photos')}
                    >
                        <Text style={[styles.mediaToggleText, mediaTab === 'photos' && styles.mediaToggleTextActive]}>
                            Photos ({totalPhotos})
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.mediaToggleItem, mediaTab === 'videos' && styles.mediaToggleItemActive]}
                        onPress={() => setMediaTab('videos')}
                    >
                        <Text style={[styles.mediaToggleText, mediaTab === 'videos' && styles.mediaToggleTextActive]}>
                            Videos ({totalVideos})
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Content Area - Scrollable Grid */}
            <View style={{ flex: 1, width: '100%' }}>
                {mediaTab === 'photos' && (
                    <View style={{ flex: 1 }}>
                        {/* Action Buttons */}
                        <View style={styles.mediaActionsRow}>
                            <TouchableOpacity style={styles.mediaActionBtnPrimary} onPress={takePhoto}>
                                <MaterialIcons name="camera-alt" size={24} color="#FFF" />
                                <Text style={styles.mediaActionBtnTextPrimary}>Camera</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.mediaActionBtnSecondary} onPress={pickGalleryPhoto}>
                                <MaterialIcons name="photo-library" size={24} color={AppColors.primary} />
                                <Text style={styles.mediaActionBtnTextSecondary}>Gallery</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Photos Grid */}
                        {totalPhotos > 0 ? (
                            <View style={styles.mediaGridContainer}>
                                {/* Local Photos */}
                                {localPhotos.map((photo, i) => (
                                    <View key={`local-${i}`} style={styles.mediaThumbContainer}>
                                        <TouchableOpacity
                                            style={styles.mediaThumb}
                                            onPress={() => openPreview('image', photo.uri)}
                                            activeOpacity={0.9}
                                        >
                                            <Image source={{ uri: photo.uri }} style={styles.mediaImage} />
                                            {photo.watermarked && (
                                                <View style={styles.miniWatermarkBadge}>
                                                    <MaterialIcons name="verified" size={8} color="#FFF" />
                                                </View>
                                            )}
                                            <View style={styles.miniSourceBadge}>
                                                <MaterialIcons
                                                    name={photo.source === 'gallery' ? 'photo-library' : 'camera-alt'}
                                                    size={8}
                                                    color="#FFF"
                                                />
                                            </View>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.mediaRemoveBtn}
                                            onPress={() => removeLocalPhoto(i)}
                                        >
                                            <MaterialIcons name="close" size={12} color="#FFF" />
                                        </TouchableOpacity>
                                    </View>
                                ))}

                                {/* Uploaded Photos */}
                                {existingPhotos.map((photo, i) => {
                                    const photoUri = getMediaUrl(photo.file_url);
                                    return (
                                        <View key={`uploaded-${i}`} style={styles.mediaThumbContainer}>
                                            <TouchableOpacity
                                                style={styles.mediaThumb}
                                                onPress={() => openPreview('image', photoUri)}
                                                activeOpacity={0.9}
                                            >
                                                <Image source={{ uri: photoUri }} style={styles.mediaImage} />
                                                <View style={styles.miniUploadedBadge}>
                                                    <MaterialIcons name="check" size={10} color="#FFF" />
                                                </View>
                                            </TouchableOpacity>
                                        </View>
                                    );
                                })}
                            </View>
                        ) : (
                            <View style={styles.mediaEmptyState}>
                                <MaterialIcons name="hide-image" size={48} color="#EEE" />
                                <Text style={styles.mediaEmptyText}>No photos added yet</Text>
                            </View>
                        )}
                    </View>
                )}

                {/* Videos Section */}
                {mediaTab === 'videos' && (
                    <View style={{ flex: 1 }}>
                        {/* Video Actions */}
                        <View style={styles.mediaActionsRow}>
                            <TouchableOpacity style={styles.mediaActionBtnPrimary} onPress={recordVideo}>
                                <MaterialIcons name="videocam" size={24} color="#FFF" />
                                <Text style={styles.mediaActionBtnTextPrimary}>Record</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.mediaActionBtnSecondary} onPress={pickGalleryVideo}>
                                <MaterialIcons name="video-library" size={24} color={AppColors.primary} />
                                <Text style={styles.mediaActionBtnTextSecondary}>Gallery</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Videos Grid */}
                        {totalVideos > 0 ? (
                            <View style={styles.mediaGridContainer}>
                                {/* Local Videos */}
                                {localVideos.map((video, i) => (
                                    <View key={`local-video-${i}`} style={styles.mediaThumbContainer}>
                                        <TouchableOpacity
                                            style={styles.mediaThumb}
                                            onPress={() => openPreview('video', video.uri)}
                                            activeOpacity={0.9}
                                        >
                                            <View style={[styles.mediaImage, styles.videoPlaceholder]}>
                                                <MaterialIcons name="play-circle-filled" size={24} color="#FFF" />
                                            </View>
                                            <View style={styles.miniDurationBadge}>
                                                <Text style={styles.miniDurationText}>{formatDuration(video.duration)}</Text>
                                            </View>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.mediaRemoveBtn}
                                            onPress={() => removeLocalVideo(i)}
                                        >
                                            <MaterialIcons name="close" size={12} color="#FFF" />
                                        </TouchableOpacity>
                                    </View>
                                ))}

                                {/* Uploaded Videos */}
                                {uploadedVideos.map((video, i) => (
                                    <View key={`uploaded-video-${i}`} style={styles.mediaThumbContainer}>
                                        <TouchableOpacity
                                            style={styles.mediaThumb}
                                            onPress={() => {
                                                const videoUri = getMediaUrl(video.file_url);
                                                openPreview('video', videoUri);
                                            }}
                                            activeOpacity={0.9}
                                        >
                                            <View style={[styles.mediaImage, styles.videoPlaceholder]}>
                                                <MaterialIcons name="play-circle-filled" size={24} color="#FFF" />
                                            </View>
                                            <View style={styles.miniUploadedBadge}>
                                                <MaterialIcons name="check" size={10} color="#FFF" />
                                            </View>
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                        ) : (
                            <View style={styles.mediaEmptyState}>
                                <MaterialIcons name="missed-video-call" size={48} color="#EEE" />
                                <Text style={styles.mediaEmptyText}>No videos added yet</Text>
                            </View>
                        )}
                    </View>
                )}
            </View>
        </View>
    );

    // Render notes step
    const renderNotesStep = () => (
        <View style={styles.fullScreenStep}>
            {/* Header */}
            <View style={styles.stepHeader}>
                <Text style={styles.stepTitle}>Inspection Notes</Text>
                <Text style={styles.stepDescription}>
                    Add any important observations about the vehicle condition (Optional).
                </Text>
            </View>

            {/* Content */}
            <View style={{ flex: 1 }}>
                <View style={styles.notesContainer}>
                    <TextInput
                        style={styles.fullScreenInput}
                        placeholder="Type your observations here..."
                        multiline
                        textAlignVertical="top"
                        value={notes}
                        onChangeText={setNotes}
                        placeholderTextColor="#AAA"
                    />
                </View>
            </View>
        </View>
    );

    // Render review step
    const renderReviewStep = () => {
        const getStatusIcon = (status) => {
            switch (status) {
                case 'done': return <MaterialIcons name="check-circle" size={20} color="#4CAF50" />;
                case 'uploading': return <ActivityIndicator size="small" color={AppColors.primary} />;
                case 'queued': return <MaterialIcons name="schedule" size={20} color="#FF9500" />;
                case 'skipped': return <MaterialIcons name="remove-circle-outline" size={20} color="#CCC" />;
                default: return <MaterialIcons name="hourglass-empty" size={20} color="#999" />;
            }
        };

        const getStatusText = (status, progress = 0) => {
            switch (status) {
                case 'done': return 'Uploaded ✓';
                case 'uploading': return `Uploading... ${progress}%`;
                case 'queued': return 'Saved for later';
                case 'skipped': return 'Skipped';
                default: return 'Pending';
            }
        };

        return (
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Review & Submit</Text>
                <Text style={styles.subtitle}>
                    {uploadProgress.isUploading
                        ? uploadProgress.currentItem
                        : 'Review your inspection data before uploading.'
                    }
                </Text>

                {/* Upload Progress Bar */}
                {uploadProgress.isUploading && (
                    <View style={styles.overallProgressContainer}>
                        <View style={styles.overallProgressBar}>
                            <View style={[
                                styles.overallProgressFill,
                                {
                                    width: `${Math.round(
                                        ([uploadProgress.selfie, ...uploadProgress.photos, ...uploadProgress.videos]
                                            .filter(i => i.status === 'done' || i.status === 'queued').length /
                                            [uploadProgress.selfie, ...uploadProgress.photos, ...uploadProgress.videos]
                                                .filter(i => i.status !== 'skipped').length) * 100
                                    ) || 0}%`
                                }
                            ]} />
                        </View>
                    </View>
                )}

                {/* Selfie Card */}
                <View style={[styles.reviewCard, uploadProgress.selfie?.status === 'uploading' && styles.reviewCardUploading]}>
                    <View style={styles.reviewRow}>
                        <MaterialIcons name="person" size={24} color={hasSelfie ? '#4CAF50' : '#CCC'} />
                        <View style={styles.reviewTextContainer}>
                            <Text style={styles.reviewLabel}>Selfie</Text>
                            <Text style={[styles.reviewValue, hasSelfie && styles.reviewValueSuccess]}>
                                {uploadProgress.isUploading
                                    ? getStatusText(uploadProgress.selfie?.status, uploadProgress.selfie?.progress)
                                    : (hasSelfie ? '✓ Captured' : 'Not taken')
                                }
                            </Text>
                        </View>
                        {uploadProgress.isUploading && getStatusIcon(uploadProgress.selfie?.status)}
                    </View>
                </View>

                {/* Photos Card */}
                <View style={[styles.reviewCard, uploadProgress.photos?.some(p => p.status === 'uploading') && styles.reviewCardUploading]}>
                    <View style={styles.reviewRow}>
                        <MaterialIcons name="photo-camera" size={24} color={totalPhotos > 0 ? '#4CAF50' : '#CCC'} />
                        <View style={styles.reviewTextContainer}>
                            <Text style={styles.reviewLabel}>Photos ({localPhotos.length} to upload)</Text>
                            {uploadProgress.isUploading ? (
                                <View style={styles.uploadItemsList}>
                                    {uploadProgress.photos.map((photo, i) => (
                                        <View key={i} style={styles.uploadItemRow}>
                                            {getStatusIcon(photo.status)}
                                            <Text style={styles.uploadItemText}>
                                                Photo {i + 1}: {getStatusText(photo.status, photo.progress)}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            ) : (
                                <Text style={[styles.reviewValue, totalPhotos > 0 && styles.reviewValueSuccess]}>
                                    {totalPhotos} photo(s) • {localPhotos.filter(p => p.watermarked).length} watermarked
                                </Text>
                            )}
                        </View>
                    </View>
                </View>

                {/* Videos Card */}
                <View style={[styles.reviewCard, uploadProgress.videos?.some(v => v.status === 'uploading') && styles.reviewCardUploading]}>
                    <View style={styles.reviewRow}>
                        <MaterialIcons name="videocam" size={24} color={totalVideos > 0 ? '#4CAF50' : '#CCC'} />
                        <View style={styles.reviewTextContainer}>
                            <Text style={styles.reviewLabel}>Videos ({localVideos.length} to upload)</Text>
                            {uploadProgress.isUploading && localVideos.length > 0 ? (
                                <View style={styles.uploadItemsList}>
                                    {uploadProgress.videos.map((video, i) => (
                                        <View key={i} style={styles.uploadItemRow}>
                                            {getStatusIcon(video.status)}
                                            <Text style={styles.uploadItemText}>
                                                Video {i + 1}: {getStatusText(video.status, video.progress)}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            ) : (
                                <Text style={[styles.reviewValue, totalVideos > 0 && styles.reviewValueSuccess]}>
                                    {totalVideos} video(s)
                                </Text>
                            )}
                        </View>
                    </View>
                </View>

                {/* Notes Card */}
                <View style={[styles.reviewCard, uploadProgress.notes?.status === 'uploading' && styles.reviewCardUploading]}>
                    <View style={styles.reviewRow}>
                        <MaterialIcons name="notes" size={24} color={notes ? '#4CAF50' : '#CCC'} />
                        <View style={styles.reviewTextContainer}>
                            <Text style={styles.reviewLabel}>Notes</Text>
                            <Text style={[styles.reviewValue, notes && styles.reviewValueSuccess]} numberOfLines={2}>
                                {uploadProgress.isUploading
                                    ? getStatusText(uploadProgress.notes?.status)
                                    : (notes || 'No notes added')
                                }
                            </Text>
                        </View>
                        {uploadProgress.isUploading && getStatusIcon(uploadProgress.notes?.status)}
                    </View>
                </View>

                {/* Location Card */}
                <View style={styles.reviewCard}>
                    <View style={styles.reviewRow}>
                        <MaterialIcons name="location-on" size={24} color={location ? '#4CAF50' : '#CCC'} />
                        <View style={styles.reviewTextContainer}>
                            <Text style={styles.reviewLabel}>Location</Text>
                            <Text style={[styles.reviewValue, location && styles.reviewValueSuccess]}>
                                {address || (location ? `${location.latitude?.toFixed(4)}, ${location.longitude?.toFixed(4)}` : 'Not available')}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Completing Status */}
                {uploadProgress.isUploading && uploadProgress.completing?.status !== 'pending' && (
                    <View style={[styles.reviewCard, styles.reviewCardUploading]}>
                        <View style={styles.reviewRow}>
                            <MaterialIcons name="cloud-done" size={24} color="#4CAF50" />
                            <View style={styles.reviewTextContainer}>
                                <Text style={styles.reviewLabel}>Completing Visit</Text>
                                <Text style={styles.reviewValue}>
                                    {getStatusText(uploadProgress.completing?.status)}
                                </Text>
                            </View>
                            {getStatusIcon(uploadProgress.completing?.status)}
                        </View>
                    </View>
                )}
            </View>
        );
    };

    // Render current step content
    const renderStepContent = () => {
        switch (currentStep) {
            case STEPS.SELFIE:
                return renderSelfieStep();
            case STEPS.MEDIA:
                return renderMediaStep();
            case STEPS.NOTES:
                return renderNotesStep();
            case STEPS.REVIEW:
                return renderReviewStep();
            default:
                return null;
        }
    };

    // Get footer button text
    const getFooterButtonText = () => {
        if (currentStep === STEPS.REVIEW) {
            return isAddPhotosMode ? 'Upload Media' : 'Upload & Complete Visit';
        }
        return 'Next';
    };

    // Handle footer button press
    const handleFooterPress = () => {
        if (currentStep === STEPS.REVIEW) {
            handleCompleteVisit();
        } else {
            goToNextStep();
        }
    };

    const canComplete = currentStep === STEPS.REVIEW && (
        isAddPhotosMode
            ? (localPhotos.length > 0 || localVideos.length > 0)
            : hasSelfie && totalMedia > 0
    );

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <MaterialIcons name="arrow-back" size={24} color="#333" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{isAddPhotosMode ? 'Add More Media' : 'Inspection'}</Text>
                <View style={{ width: 40 }} />
            </View>

            {/* Processing Overlay */}
            {processing && (
                <View style={styles.processingOverlay}>
                    <View style={styles.processingBox}>
                        <ActivityIndicator size="large" color={AppColors.primary} />
                        <Text style={styles.processingText}>{processingMessage}</Text>
                    </View>
                </View>
            )}

            {/* Hidden ViewShot for watermarking */}
            {tempImageForWatermark && (
                <View style={styles.hiddenViewShot}>
                    <ViewShot
                        ref={tempImageForWatermark.type === 'selfie' ? selfieViewShotRef : (ref) => {
                            if (ref && tempImageForWatermark.id) {
                                photoViewShotRefs.current[tempImageForWatermark.id] = ref;
                            }
                        }}
                        options={{ format: 'jpg', quality: 0.95 }}
                        style={styles.viewShotContainer}
                    >
                        <Image
                            source={{ uri: tempImageForWatermark.uri }}
                            style={styles.viewShotImage}
                            contentFit="contain"
                        />
                        <View style={watermarkStyles.container}>
                            <Text style={watermarkStyles.text}>{tempImageForWatermark.timestamp}</Text>
                            <Text style={watermarkStyles.locationText}>📍 {tempImageForWatermark.location}</Text>
                        </View>
                    </ViewShot>
                </View>
            )}

            {/* Step Content */}
            {currentStep === STEPS.SELFIE ? (
                <View style={styles.content}>
                    {renderStepContent()}
                </View>
            ) : (
                <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    {renderStepContent()}
                    <View style={{ height: 100 }} />
                </ScrollView>
            )}

            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 16, 24) }]}>
                {/* Dot Indicators */}
                <View style={styles.dotIndicators}>
                    {(isAddPhotosMode
                        ? [STEPS.MEDIA, STEPS.NOTES, STEPS.REVIEW]
                        : [STEPS.SELFIE, STEPS.MEDIA, STEPS.NOTES, STEPS.REVIEW]
                    ).map((step) => (
                        <View
                            key={step}
                            style={[
                                styles.dot,
                                currentStep >= step && styles.dotActive,
                                currentStep === step && styles.dotCurrent
                            ]}
                        />
                    ))}
                </View>

                <View style={styles.footerButtons}>
                    {currentStep > (isAddPhotosMode ? STEPS.MEDIA : STEPS.SELFIE) && (
                        <TouchableOpacity
                            style={styles.backButton}
                            onPress={goToPrevStep}
                        >
                            <MaterialIcons name="arrow-back" size={20} color={AppColors.primary} />
                            <Text style={styles.backButtonText}>Back</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        style={[
                            styles.submitBtn,
                            currentStep === STEPS.REVIEW && !canComplete && styles.disabledBtn,
                            currentStep === STEPS.REVIEW && styles.submitBtnComplete,
                            currentStep < STEPS.REVIEW && !canGoToNextStep() && styles.disabledBtn
                        ]}
                        onPress={handleFooterPress}
                        disabled={loading || (currentStep === STEPS.REVIEW ? !canComplete : !canGoToNextStep())}
                    >
                        {loading ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <>
                                {currentStep === STEPS.REVIEW && (
                                    <MaterialIcons name="cloud-upload" size={20} color="#FFF" style={{ marginRight: 8 }} />
                                )}
                                <Text style={styles.submitBtnText}>{getFooterButtonText()}</Text>
                                {currentStep < STEPS.REVIEW && (
                                    <MaterialIcons name="arrow-forward" size={20} color="#FFF" style={{ marginLeft: 8 }} />
                                )}
                            </>
                        )}
                    </TouchableOpacity>
                </View>
                {currentStep === STEPS.SELFIE && !hasSelfie && (
                    <Text style={styles.helperText}>Take a selfie to continue</Text>
                )}
                {currentStep === STEPS.MEDIA && totalMedia === 0 && (
                    <Text style={styles.helperText}>Add at least one photo or video to continue</Text>
                )}
            </View>

            {/* Full-Screen Preview Modal */}
            <Modal
                visible={previewModal.visible}
                transparent={true}
                animationType="fade"
                onRequestClose={closePreview}
            >
                <View style={styles.previewModal}>
                    <TouchableOpacity style={styles.previewClose} onPress={closePreview}>
                        <MaterialIcons name="close" size={28} color="#FFF" />
                    </TouchableOpacity>

                    {previewModal.type === 'image' && previewModal.uri && (
                        <Image
                            source={{ uri: previewModal.uri }}
                            style={styles.previewImage}
                            contentFit="contain"
                        />
                    )}

                    {previewModal.type === 'video' && previewModal.uri && (
                        <Video
                            source={{ uri: previewModal.uri }}
                            style={styles.previewVideo}
                            useNativeControls
                            resizeMode="contain"
                            shouldPlay={true}
                            isLooping
                        />
                    )}
                </View>
            </Modal>
        </View>
    );
}

const { width: screenWidth } = Dimensions.get('window');

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFF' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 12,
        backgroundColor: '#FFF'
    },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '600', color: '#1A1A1A' },

    // Step Indicator - Clean minimal style
    stepIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFF',
        paddingVertical: 16,
        paddingHorizontal: 20,
    },
    stepItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    stepCircle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#F0F0F0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    stepCircleActive: {
        backgroundColor: AppColors.primary,
    },
    stepCircleCurrent: {
        backgroundColor: AppColors.primary,
    },
    stepNumber: {
        fontSize: 13,
        fontWeight: '700',
        color: '#999',
    },
    stepNumberActive: {
        color: '#FFF',
    },
    stepLabel: {
        fontSize: 11,
        color: '#BBB',
        marginLeft: 6,
        marginRight: 10,
    },
    stepLabelActive: {
        color: '#1A1A1A',
        fontWeight: '600',
    },
    stepLine: {
        width: 24,
        height: 2,
        backgroundColor: '#E8E8E8',
        marginRight: 10,
    },
    stepLineActive: {
        backgroundColor: AppColors.primary,
    },

    // Full-Screen Step Layout Styles
    fullScreenStep: {
        flex: 1,
        paddingHorizontal: 24,
    },
    stepHeader: {
        paddingTop: 20,
        paddingBottom: 16,
    },
    stepTitle: {
        fontSize: 28,
        fontWeight: '700',
        color: '#1A1A1A',
        letterSpacing: -0.5,
        marginBottom: 8,
    },
    stepDescription: {
        fontSize: 16,
        color: '#666',
        lineHeight: 22,
    },
    stepContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stepActionArea: {
        paddingBottom: 20,
        alignItems: 'center',
    },
    mainActionBtn: {
        backgroundColor: AppColors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        paddingVertical: 18,
        paddingHorizontal: 48,
        borderRadius: 30,
        width: '100%',
    },
    mainActionBtnText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '700',
    },
    stepHint: {
        fontSize: 13,
        color: '#999',
        marginTop: 16,
        textAlign: 'center',
    },

    // Selfie Full-Screen Styles
    selfiePreviewContainer: {
        alignItems: 'center',
    },
    selfiePreviewImage: {
        width: 240,
        height: 320,
        borderRadius: 20,
    },
    watermarkIndicator: {
        position: 'absolute',
        bottom: 12,
        left: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(76, 175, 80, 0.9)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 14,
    },
    watermarkIndicatorText: {
        color: '#FFF',
        fontSize: 12,
        fontWeight: '600',
    },
    retakeBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 20,
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderWidth: 1.5,
        borderColor: AppColors.primary,
        borderRadius: 24,
    },
    retakeBtnText: {
        color: AppColors.primary,
        fontSize: 15,
        fontWeight: '600',
    },
    uploadedIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 16,
    },
    uploadedIndicatorText: {
        color: '#4CAF50',
        fontSize: 15,
        fontWeight: '600',
    },
    selfiePlaceholder: {
        alignItems: 'center',
    },
    selfiePlaceholderCircle: {
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: '#F5F5F5',
        borderWidth: 3,
        borderColor: '#E0E0E0',
        borderStyle: 'dashed',
        justifyContent: 'center',
        alignItems: 'center',
    },
    selfiePlaceholderText: {
        marginTop: 20,
        fontSize: 15,
        color: '#999',
    },

    content: { flex: 1 },
    scrollContent: { flex: 1, padding: 16 },
    section: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 3,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '700',
        marginBottom: 6,
        color: '#1A1A1A',
        letterSpacing: -0.3,
    },
    subtitle: {
        fontSize: 14,
        color: '#666',
        marginBottom: 20,
        lineHeight: 21,
    },

    cameraBtn: {
        backgroundColor: AppColors.primary,
        borderRadius: 16,
        padding: 28,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 12,
        shadowColor: AppColors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    cameraBtnText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    selfieContainer: {
        alignItems: 'center',
        position: 'relative',
        backgroundColor: '#F8F9FA',
        borderRadius: 16,
        padding: 16,
    },
    selfieImage: {
        width: 200,
        height: 260,
        borderRadius: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
    },
    checkMark: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#E8F5E9',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    pendingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#FFF5E6',
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 20,
        marginTop: 8,
    },
    pendingText: { color: '#FF9500', fontWeight: '600', fontSize: 13 },
    watermarkBadge: {
        position: 'absolute',
        top: 8,
        left: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(76, 175, 80, 0.9)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    watermarkBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '600' },
    watermarkBadgeSmall: {
        position: 'absolute',
        top: 4,
        left: 4,
        backgroundColor: 'rgba(76, 175, 80, 0.9)',
        borderRadius: 10,
        width: 18,
        height: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    removeBtn: {
        position: 'absolute',
        top: 5,
        right: 5,
        backgroundColor: 'rgba(255,59,48,0.9)',
        borderRadius: 15,
        width: 30,
        height: 30,
        justifyContent: 'center',
        alignItems: 'center',
    },

    mediaToggle: {
        flexDirection: 'row',
        backgroundColor: '#F0F0F5',
        borderRadius: 14,
        padding: 4,
        marginBottom: 20,
    },
    mediaToggleBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 12,
    },
    mediaToggleBtnActive: {
        backgroundColor: '#FFF',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    mediaToggleText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#888',
    },
    mediaToggleTextActive: {
        color: AppColors.primary,
    },

    photoActions: { flexDirection: 'row', gap: 12, marginBottom: 20 },
    actionBtn: {
        flex: 1,
        backgroundColor: AppColors.primary,
        padding: 14,
        borderRadius: 14,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        shadowColor: AppColors.primary,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
        elevation: 4,
    },
    galleryBtn: {
        backgroundColor: '#F8F6FF',
        borderWidth: 1.5,
        borderColor: AppColors.primary,
        shadowColor: '#000',
        shadowOpacity: 0.05,
    },
    actionBtnText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
    photoSection: {
        marginBottom: 16,
        backgroundColor: '#FAFAFA',
        borderRadius: 12,
        padding: 12,
    },
    photoSectionLabel: {
        fontSize: 13,
        color: '#555',
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        fontWeight: '500',
    },
    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    photoThumb: {
        width: '31%',
        aspectRatio: 1,
        backgroundColor: '#EEE',
        borderRadius: 8,
        position: 'relative',
        overflow: 'hidden',
    },
    photoImage: { flex: 1, borderRadius: 8 },
    photoRemoveBtn: {
        position: 'absolute',
        top: 4,
        right: 4,
        backgroundColor: 'rgba(255,59,48,0.9)',
        borderRadius: 12,
        width: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    uploadedBadge: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        backgroundColor: '#4CAF50',
        borderRadius: 10,
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.2)',
    },
    videoPlaceholder: {
        backgroundColor: '#DDD',
        justifyContent: 'center',
        alignItems: 'center',
    },
    durationBadge: {
        position: 'absolute',
        bottom: 4,
        left: 4,
        backgroundColor: 'rgba(0,0,0,0.7)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    durationText: {
        color: '#FFF',
        fontSize: 10,
        fontWeight: '600',
    },
    emptyPhotos: {
        alignItems: 'center',
        paddingVertical: 40,
        backgroundColor: '#FAFAFA',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#EEE',
        borderStyle: 'dashed',
    },
    emptyText: { color: '#999', marginTop: 10, fontSize: 14 },
    input: {
        backgroundColor: '#F8F9FA',
        borderRadius: 14,
        padding: 16,
        minHeight: 140,
        textAlignVertical: 'top',
        borderWidth: 1.5,
        borderColor: '#E8E8E8',
        fontSize: 15,
        lineHeight: 22,
        color: '#333',
    },

    // Review styles
    reviewCard: {
        backgroundColor: '#FFF',
        borderRadius: 14,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#F0F0F0',
    },
    reviewRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    reviewTextContainer: {
        marginLeft: 14,
        flex: 1,
    },
    reviewLabel: {
        fontSize: 13,
        color: '#888',
        marginBottom: 3,
        fontWeight: '500',
    },
    reviewValue: {
        fontSize: 15,
        color: '#333',
        fontWeight: '600',
    },
    reviewValueSuccess: {
        color: '#4CAF50',
    },
    reviewCardUploading: {
        backgroundColor: '#FFF8E1',
        borderWidth: 1,
        borderColor: '#FFE082',
    },
    overallProgressContainer: {
        marginBottom: 16,
    },
    overallProgressBar: {
        height: 8,
        backgroundColor: '#E0E0E0',
        borderRadius: 4,
        overflow: 'hidden',
    },
    overallProgressFill: {
        height: '100%',
        backgroundColor: AppColors.primary,
        borderRadius: 4,
    },
    uploadItemsList: {
        marginTop: 8,
    },
    uploadItemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
    },
    uploadItemText: {
        fontSize: 13,
        color: '#666',
        marginLeft: 8,
    },

    // Footer styles
    footer: {
        padding: 16,
        backgroundColor: '#FFF',
        paddingBottom: 36,
    },
    dotIndicators: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        marginBottom: 20,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#E0E0E0',
    },
    dotActive: {
        backgroundColor: AppColors.primary,
    },
    dotCurrent: {
        width: 24,
        borderRadius: 4,
    },
    footerButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: AppColors.primary,
        gap: 6,
        backgroundColor: '#FFF',
    },
    backButtonText: {
        color: AppColors.primary,
        fontSize: 15,
        fontWeight: '600',
    },
    submitBtn: {
        flex: 1,
        backgroundColor: AppColors.primary,
        padding: 18,
        borderRadius: 14,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        shadowColor: AppColors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    submitBtnComplete: {
        backgroundColor: AppColors.success || '#4CAF50',
        shadowColor: '#4CAF50',
    },
    disabledBtn: {
        backgroundColor: '#CCC',
        shadowOpacity: 0,
        elevation: 0,
    },
    submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
    helperText: {
        textAlign: 'center',
        color: '#888',
        fontSize: 13,
        marginTop: 10,
    },
    sourceBadge: {
        position: 'absolute',
        bottom: 4,
        left: 28,
        borderRadius: 10,
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sourceBadgeCamera: {
        backgroundColor: '#2196F3',
    },
    sourceBadgeGallery: {
        backgroundColor: '#9C27B0',
    },

    // Processing overlay
    processingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    processingBox: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        minWidth: 200,
    },
    processingText: {
        marginTop: 16,
        fontSize: 14,
        color: '#333',
        textAlign: 'center',
    },

    // Hidden ViewShot for watermarking
    hiddenViewShot: {
        position: 'absolute',
        top: -2000,
        left: 0,
        opacity: 0,
    },
    viewShotContainer: {
        width: screenWidth,
        height: screenWidth * 1.33,
        backgroundColor: '#000',
    },
    viewShotImage: {
        flex: 1,
    },

    // Preview Modal styles
    previewModal: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    previewClose: {
        position: 'absolute',
        top: 50,
        right: 20,
        zIndex: 10,
        padding: 10,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 20,
    },
    previewImage: {
        width: '100%',
        height: '80%',
    },
    previewVideo: {
        width: '100%',
        height: '70%',
    },
    // Media Step Styles (New)
    mediaToggleContainer: {
        alignItems: 'center',
        marginVertical: 16,
    },
    mediaTogglePill: {
        flexDirection: 'row',
        backgroundColor: '#F0F0F0',
        borderRadius: 25,
        padding: 4,
    },
    mediaToggleItem: {
        paddingHorizontal: 20,
        paddingVertical: 8,
        borderRadius: 20,
    },
    mediaToggleItemActive: {
        backgroundColor: '#FFF',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    mediaToggleText: {
        color: '#666',
        fontWeight: '500',
        fontSize: 14,
    },
    mediaToggleTextActive: {
        color: AppColors.primary,
        fontWeight: '600',
    },
    mediaActionsRow: {
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 4,
        marginBottom: 16,
    },
    mediaActionBtnPrimary: {
        flex: 1,
        backgroundColor: AppColors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 12,
        gap: 8,
    },
    mediaActionBtnSecondary: {
        flex: 1,
        backgroundColor: '#e3f2fd',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 12,
        gap: 8,
        borderWidth: 1,
        borderColor: '#bbdefb',
    },
    mediaActionBtnTextPrimary: {
        color: '#FFF',
        fontWeight: '600',
        fontSize: 15,
    },
    mediaActionBtnTextSecondary: {
        color: AppColors.primary,
        fontWeight: '600',
        fontSize: 15,
    },
    mediaGridContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        paddingBottom: 20,
    },
    mediaThumbContainer: {
        width: '31%',
        aspectRatio: 1,
        position: 'relative',
    },
    mediaThumb: {
        flex: 1,
        borderRadius: 10,
        backgroundColor: '#F8F8F8',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#EEE',
    },
    mediaImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    mediaRemoveBtn: {
        position: 'absolute',
        top: -6,
        right: -6,
        backgroundColor: '#EF4444',
        width: 20,
        height: 20,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 5,
        borderWidth: 1.5,
        borderColor: '#FFF',
    },
    miniWatermarkBadge: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 4,
        padding: 2,
    },
    miniSourceBadge: {
        position: 'absolute',
        top: 4,
        left: 4,
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 10,
        width: 16,
        height: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    miniUploadedBadge: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        backgroundColor: '#4CAF50',
        borderRadius: 8,
        width: 16,
        height: 16,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#FFF',
    },
    miniDurationBadge: {
        position: 'absolute',
        bottom: 4,
        left: 4,
        backgroundColor: 'rgba(0,0,0,0.7)',
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: 3,
    },
    miniDurationText: {
        color: '#FFF',
        fontSize: 9,
        fontWeight: '600',
    },
    mediaEmptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        opacity: 0.7,
    },
    mediaEmptyText: {
        marginTop: 12,
        fontSize: 15,
        color: '#888',
        fontWeight: '500',
    },
    // Notes Step Styles (New)
    notesContainer: {
        flex: 1,
        backgroundColor: '#F8F9FA',
        borderRadius: 16,
        padding: 4,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#E8E8E8',
    },
    fullScreenInput: {
        flex: 1,
        fontSize: 16,
        color: '#333',
        lineHeight: 24,
        padding: 16,
        textAlignVertical: 'top',
    },
});
