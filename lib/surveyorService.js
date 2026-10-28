import api from './api';
import offlineDb from './offlineDb';
import { isOnline } from '../hooks/useNetworkStatus';

export const surveyorService = {
    // Profile & List
    getProfile: async () => {
        const response = await api.get('/surveyor/profile');
        return response.data;
    },

    getSurveys: async (params = {}) => {
        try {
            // Check if online
            if (await isOnline()) {
                const response = await api.get('/surveyor/surveys', params);
                // Cache the surveys for offline use
                if (response.data) {
                    const surveys = Array.isArray(response.data) ? response.data : (response.data.surveys || []);
                    await offlineDb.cacheSurveys(surveys);
                }
                return response.data;
            } else {
                // Offline - return cached data
                console.log('📵 Offline: Loading cached surveys');
                const cachedSurveys = await offlineDb.getCachedSurveys();
                return { surveys: cachedSurveys, fromCache: true };
            }
        } catch (error) {
            // On network error, try to return cached data
            console.log('⚠️ Network error, falling back to cache:', error.message);
            const cachedSurveys = await offlineDb.getCachedSurveys();
            if (cachedSurveys.length > 0) {
                return { surveys: cachedSurveys, fromCache: true };
            }
            throw error;
        }
    },

    // Survey Details
    getSurveyDetail: async (id) => {
        try {
            // Check if online
            if (await isOnline()) {
                const response = await api.get(`/surveyor/surveys/${id}`);
                // Cache the survey detail for offline use
                if (response.data) {
                    await offlineDb.cacheSurveyDetail(id, response.data);
                }
                return response.data;
            } else {
                // Offline - return cached data
                console.log('📵 Offline: Loading cached survey detail');
                const cached = await offlineDb.getCachedSurveyDetail(id);
                if (cached) {
                    return { ...cached, fromCache: true };
                }
                throw new Error('Survey not available offline. Please connect to the internet.');
            }
        } catch (error) {
            // On network error, try to return cached data
            console.log('⚠️ Network error, falling back to cache:', error.message);
            const cached = await offlineDb.getCachedSurveyDetail(id);
            if (cached) {
                return { ...cached, fromCache: true };
            }
            throw error;
        }
    },

    // Transit & Location
    startTransit: async (id, latitude, longitude) => {
        const data = (latitude && longitude) ? { latitude, longitude } : {};
        const response = await api.put(`/surveyor/surveys/${id}/start-transit`, data);
        return response.data;
    },

    updateLocation: async (id, latitude, longitude) => {
        const response = await api.post(`/surveyor/surveys/${id}/location-update`, { latitude, longitude });
        return response.data;
    },

    markArrived: async (id, latitude, longitude) => {
        const response = await api.put(`/surveyor/surveys/${id}/arrived`, { latitude, longitude });
        return response.data;
    },

    // Photos & Documents
    uploadSelfie: async (id, imageUri, latitude, longitude, capturedAt = null, sessionNumber = 1) => {
        const formData = new FormData();
        const filename = imageUri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';

        formData.append('selfie', { uri: imageUri, name: filename, type });
        if (latitude) formData.append('latitude', latitude);
        if (longitude) formData.append('longitude', longitude);
        // Add captured_at timestamp for date/time stamp
        formData.append('captured_at', capturedAt || new Date().toISOString());
        formData.append('session_number', String(sessionNumber));

        const response = await api.upload(`/surveyor/surveys/${id}/selfie`, formData);
        return response.data;
    },

    uploadPhotos: async (id, photos, latitude, longitude, caption, sessionNumber = 1) => {
        const formData = new FormData();

        // Collect source types and captured_at timestamps for each photo
        const sourceTypes = [];
        const capturedAtTimes = [];

        photos.forEach((photo) => {
            const filename = photo.uri.split('/').pop();
            const match = /\.(\w+)$/.exec(filename);
            const type = match ? `image/${match[1]}` : 'image/jpeg';
            formData.append('photos', { uri: photo.uri, name: filename, type });
            // Track source type: 'camera' or 'gallery'
            sourceTypes.push(photo.source || 'camera');
            // Track captured_at timestamp
            capturedAtTimes.push(photo.capturedAt || new Date().toISOString());
        });

        if (latitude) formData.append('latitude', latitude);
        if (longitude) formData.append('longitude', longitude);
        if (caption) formData.append('caption', caption);

        // Default to 'live' photos as per backend default if not specified
        formData.append('photo_type', 'live');

        // Send source types as JSON array
        formData.append('source_types', JSON.stringify(sourceTypes));
        // Send captured_at timestamps as JSON array
        formData.append('captured_at_times', JSON.stringify(capturedAtTimes));
        formData.append('session_number', String(sessionNumber));

        const response = await api.upload(`/surveyor/surveys/${id}/photos`, formData);
        return response.data;
    },

    // Upload Videos
    uploadVideos: async (id, videos, latitude, longitude, caption, sessionNumber = 1) => {
        const formData = new FormData();

        // Collect source types, captured_at timestamps, and durations for each video
        const sourceTypes = [];
        const capturedAtTimes = [];
        const durations = [];

        videos.forEach((video) => {
            const filename = video.uri.split('/').pop();
            const match = /\.(\w+)$/.exec(filename);
            const type = match ? `video/${match[1]}` : 'video/mp4';
            formData.append('videos', { uri: video.uri, name: filename, type });
            // Track source type: 'camera' or 'gallery'
            sourceTypes.push(video.source || 'camera');
            // Track captured_at timestamp
            capturedAtTimes.push(video.capturedAt || new Date().toISOString());
            // Track duration in seconds
            durations.push(video.duration || 0);
        });

        if (latitude) formData.append('latitude', latitude);
        if (longitude) formData.append('longitude', longitude);
        if (caption) formData.append('caption', caption);

        // Send metadata as JSON arrays
        formData.append('source_types', JSON.stringify(sourceTypes));
        formData.append('captured_at_times', JSON.stringify(capturedAtTimes));
        formData.append('durations', JSON.stringify(durations));
        formData.append('session_number', String(sessionNumber));

        const response = await api.upload(`/surveyor/surveys/${id}/videos`, formData);
        return response.data;
    },

    getPhotos: async (id) => {
        const response = await api.get(`/surveyor/surveys/${id}/photos`);
        return response.data;
    },

    getDocuments: async (id) => {
        const response = await api.get(`/surveyor/surveys/${id}/documents`);
        return response.data;
    },

    getVideos: async (id) => {
        const response = await api.get(`/surveyor/surveys/${id}/videos`);
        return response.data;
    },

    deletePhoto: async (surveyId, photoId) => {
        const response = await api.delete(`/surveyor/surveys/${surveyId}/photos/${photoId}`);
        return response.data;
    },

    deleteVideo: async (surveyId, videoId) => {
        const response = await api.delete(`/surveyor/surveys/${surveyId}/videos/${videoId}`);
        return response.data;
    },

    // Completion & Report
    completeVisit: async (id) => {
        const response = await api.put(`/surveyor/surveys/${id}/complete-visit`, {});
        return response.data;
    },

    submitReport: async (id, pdfUri, notes) => {
        const formData = new FormData();
        const filename = pdfUri.split('/').pop();

        formData.append('report', { uri: pdfUri, name: filename, type: 'application/pdf' });
        if (notes) formData.append('surveyor_notes', notes);

        const response = await api.upload(`/surveyor/surveys/${id}/reports`, formData);
        return response.data;
    },

    updateNotes: async (id, notes, sessionNumber = 1) => {
        const response = await api.put(`/surveyor/surveys/${id}/notes`, {
            notes,
            session_number: sessionNumber,
        });
        return response.data;
    },

    getSessionNotes: async (id) => {
        const response = await api.get(`/surveyor/surveys/${id}/notes`);
        return response.data;
    },

    // Chat methods
    getChatMessages: async (surveyId) => {
        const response = await api.get(`/surveyor/surveys/${surveyId}/chat`);
        return response.data;
    },

    sendChatMessage: async (surveyId, message) => {
        const response = await api.post(`/surveyor/surveys/${surveyId}/chat`, { message });
        return response.data;
    },

    // Available Broadcasts (New Survey Requests)
    // v2 §2.3: an excluded non-Prime employee gets an empty list plus an
    // explanatory message, so the message has to survive the unwrap.
    getAvailableBroadcasts: async () => {
        const response = await api.get('/surveyor/available-surveys');
        return {
            surveys: response.data || [],
            // The generic 'Success' default carries no information for the user.
            message: response.message && response.message !== 'Success' ? response.message : '',
        };
    },

    // Dispute methods
    getDispute: async (surveyId) => {
        const response = await api.get(`/surveyor/surveys/${surveyId}/dispute`);
        return response.data;
    },

    sendDisputeMessage: async (disputeId, message) => {
        const response = await api.post(`/surveyor/disputes/${disputeId}/messages`, { message_text: message });
        return response.data;
    },

    acceptBroadcast: async (surveyId, timeToStartMinutes) => {
        const response = await api.post(`/surveyor/surveys/${surveyId}/accept-broadcast`, {
            time_to_start_minutes: timeToStartMinutes
        });
        return response.data;
    },

    // ==================== OFFLINE-AWARE UPLOAD METHODS ====================

    /**
     * Upload selfie with offline support
     * If offline, queues the upload for later sync
     */
    uploadSelfieOfflineAware: async (id, imageUri, latitude, longitude, capturedAt = null, sessionNumber = 1) => {
        const online = await isOnline();
        const timestamp = capturedAt || new Date().toISOString();

        if (online) {
            // Online - upload directly
            return surveyorService.uploadSelfie(id, imageUri, latitude, longitude, timestamp, sessionNumber);
        } else {
            // Offline - queue for later
            console.log('📵 Offline: Queuing selfie upload');
            const uploadId = await offlineDb.queueUpload(id, 'selfie', imageUri, {
                latitude,
                longitude,
                capturedAt: timestamp,
                sessionNumber
            });
            return { queued: true, uploadId, message: 'Selfie queued for upload when online' };
        }
    },

    /**
     * Upload photos with offline support
     * If offline, queues each photo for later sync
     */
    uploadPhotosOfflineAware: async (id, photos, latitude, longitude, caption, sessionNumber = 1) => {
        const online = await isOnline();

        if (online) {
            // Online - upload directly
            return surveyorService.uploadPhotos(id, photos, latitude, longitude, caption, sessionNumber);
        } else {
            // Offline - queue each photo
            console.log('📵 Offline: Queuing photo uploads');
            const queuedIds = [];

            for (const photo of photos) {
                const uploadId = await offlineDb.queueUpload(id, 'photo', photo.uri, {
                    latitude,
                    longitude,
                    source: photo.source || 'camera',
                    capturedAt: photo.capturedAt || new Date().toISOString(),
                    caption,
                    sessionNumber
                });
                queuedIds.push(uploadId);
            }

            return {
                queued: true,
                uploadIds: queuedIds,
                count: queuedIds.length,
                message: `${queuedIds.length} photo(s) queued for upload when online`
            };
        }
    },

    /**
     * Upload videos with offline support
     * If offline, queues each video for later sync
     */
    uploadVideosOfflineAware: async (id, videos, latitude, longitude, caption, sessionNumber = 1) => {
        const online = await isOnline();

        if (online) {
            // Online - upload directly
            return surveyorService.uploadVideos(id, videos, latitude, longitude, caption, sessionNumber);
        } else {
            // Offline - queue each video
            console.log('📵 Offline: Queuing video uploads');
            const queuedIds = [];

            for (const video of videos) {
                const uploadId = await offlineDb.queueUpload(id, 'video', video.uri, {
                    latitude,
                    longitude,
                    source: video.source || 'camera',
                    capturedAt: video.capturedAt || new Date().toISOString(),
                    duration: video.duration || 0,
                    caption,
                    sessionNumber
                });
                queuedIds.push(uploadId);
            }

            return {
                queued: true,
                uploadIds: queuedIds,
                count: queuedIds.length,
                message: `${queuedIds.length} video(s) queued for upload when online`
            };
        }
    },

    /**
     * Save notes for a session with offline support. Notes are queued instead
     * of dropped when offline, so re-visit remarks survive the trip back online.
     */
    updateNotesOfflineAware: async (id, notes, sessionNumber = 1) => {
        const online = await isOnline();
        if (online) {
            return surveyorService.updateNotes(id, notes, sessionNumber);
        }
        const uploadId = await offlineDb.queueNotes(id, sessionNumber, notes);
        return { queued: true, uploadId, message: 'Notes queued for upload when online' };
    },

    /**
     * Get pending upload count for a survey
     */
    getPendingUploadsCount: async (surveyId) => {
        if (surveyId) {
            const uploads = await offlineDb.getPendingUploadsForSurvey(surveyId);
            return uploads.length;
        }
        return await offlineDb.getPendingUploadsCount();
    },

    /**
     * Get all pending uploads for a survey
     */
    getPendingUploads: async (surveyId) => {
        if (surveyId) {
            return await offlineDb.getPendingUploadsForSurvey(surveyId);
        }
        return await offlineDb.getPendingUploads();
    },

    // ==================== WALLET ====================

    /**
     * Get wallet balance and summary
     */
    getWalletBalance: async () => {
        const response = await api.get('/surveyor/wallet');
        return response.data;
    },

    /**
     * Get wallet transactions with pagination
     * @param {Object} params - { page, limit, type }
     */
    getWalletTransactions: async (params = {}) => {
        const response = await api.get('/surveyor/wallet/transactions', params);
        return response.data;
    }
};

export default surveyorService;
