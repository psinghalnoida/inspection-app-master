/**
 * Sync Service
 * Handles automatic syncing of pending uploads when network is available
 */

import { isOnline } from '../hooks/useNetworkStatus';
import offlineDb from './offlineDb';
import surveyorService from './surveyorService';

// Event listeners for sync status updates
const listeners = new Set();

// Sync state
let isSyncing = false;
let syncProgress = { current: 0, total: 0 };

/**
 * Subscribe to sync status updates
 * @param {(status: { isSyncing: boolean, progress: { current: number, total: number } }) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export const subscribeSyncStatus = (callback) => {
    listeners.add(callback);
    // Immediately notify with current state
    callback({ isSyncing, progress: syncProgress });
    return () => listeners.delete(callback);
};

/**
 * Notify all listeners of sync status change
 */
const notifyListeners = () => {
    const status = { isSyncing, progress: syncProgress };
    listeners.forEach(listener => {
        try {
            listener(status);
        } catch (error) {
            console.error('Sync listener error:', error);
        }
    });
};

/**
 * Process all pending uploads
 * @returns {Promise<{ success: number, failed: number }>}
 */
export const processPendingUploads = async () => {
    if (isSyncing) {
        console.log('⏳ Sync already in progress');
        return { success: 0, failed: 0 };
    }

    // Check if online
    const online = await isOnline();
    if (!online) {
        console.log('📵 Offline - skipping sync');
        return { success: 0, failed: 0 };
    }

    isSyncing = true;
    await offlineDb.updateSyncStatus(true);
    notifyListeners();

    let successCount = 0;
    let failedCount = 0;

    try {
        // Get all pending uploads
        const pendingUploads = await offlineDb.getPendingUploads();
        syncProgress = { current: 0, total: pendingUploads.length };
        notifyListeners();

        if (pendingUploads.length === 0) {
            console.log('✅ No pending uploads');
            return { success: 0, failed: 0 };
        }

        console.log(`🔄 Processing ${pendingUploads.length} pending uploads...`);

        for (const upload of pendingUploads) {
            // Check if still online
            if (!await isOnline()) {
                console.log('📵 Connection lost during sync');
                break;
            }

            // Skip uploads that have failed too many times (max 3 retries)
            if (upload.retry_count >= 3) {
                console.log(`⏭️ Skipping upload ${upload.id} after 3 failed attempts`);
                failedCount++;
                continue;
            }

            try {
                await offlineDb.updateUploadStatus(upload.id, 'uploading');

                // Process based on type
                await processUpload(upload);

                // Success - remove from queue
                await offlineDb.removeCompletedUpload(upload.id);
                successCount++;
                console.log(`✅ Synced ${upload.type} for survey ${upload.survey_id}`);
            } catch (error) {
                console.error(`❌ Failed to sync upload ${upload.id}:`, error.message);
                await offlineDb.updateUploadStatus(upload.id, 'failed', error.message);
                failedCount++;
            }

            syncProgress.current++;
            notifyListeners();
        }

        console.log(`📊 Sync complete: ${successCount} success, ${failedCount} failed`);
    } catch (error) {
        console.error('❌ Sync process error:', error);
    } finally {
        isSyncing = false;
        syncProgress = { current: 0, total: 0 };
        await offlineDb.updateSyncStatus(false);
        notifyListeners();
    }

    return { success: successCount, failed: failedCount };
};

/**
 * Process a single upload
 * @param {Object} upload - Upload record from database
 */
const processUpload = async (upload) => {
    const { survey_id, type, file_uri, metadata } = upload;

    const sessionNumber = metadata.sessionNumber || 1;

    switch (type) {
        case 'selfie':
            await surveyorService.uploadSelfie(
                survey_id,
                file_uri,
                metadata.latitude,
                metadata.longitude,
                metadata.capturedAt,
                sessionNumber
            );
            break;

        case 'photo':
            await surveyorService.uploadPhotos(
                survey_id,
                [{
                    uri: file_uri,
                    source: metadata.source || 'camera',
                    capturedAt: metadata.capturedAt
                }],
                metadata.latitude,
                metadata.longitude,
                metadata.caption,
                sessionNumber
            );
            break;

        case 'video':
            await surveyorService.uploadVideos(
                survey_id,
                [{
                    uri: file_uri,
                    source: metadata.source || 'camera',
                    capturedAt: metadata.capturedAt,
                    duration: metadata.duration || 0
                }],
                metadata.latitude,
                metadata.longitude,
                metadata.caption,
                sessionNumber
            );
            break;

        case 'notes':
            await surveyorService.updateNotes(
                survey_id,
                metadata.notes ?? '',
                sessionNumber
            );
            break;

        default:
            throw new Error(`Unknown upload type: ${type}`);
    }
};

/**
 * Retry a specific failed upload
 * @param {number} uploadId
 */
export const retryUpload = async (uploadId) => {
    const online = await isOnline();
    if (!online) {
        throw new Error('No internet connection');
    }

    const pendingUploads = await offlineDb.getPendingUploads();
    const upload = pendingUploads.find(u => u.id === uploadId);

    if (!upload) {
        throw new Error('Upload not found');
    }

    try {
        await offlineDb.updateUploadStatus(uploadId, 'uploading');
        await processUpload(upload);
        await offlineDb.removeCompletedUpload(uploadId);
        return true;
    } catch (error) {
        await offlineDb.updateUploadStatus(uploadId, 'failed', error.message);
        throw error;
    }
};

/**
 * Cancel a pending upload
 * @param {number} uploadId
 */
export const cancelUpload = async (uploadId) => {
    await offlineDb.removeCompletedUpload(uploadId);
};

/**
 * Get current sync status
 */
export const getSyncStatus = () => ({
    isSyncing,
    progress: syncProgress
});

/**
 * Check if currently syncing
 */
export const isSyncInProgress = () => isSyncing;

/**
 * Manually trigger sync (used when online callback fires)
 */
export const triggerSync = async () => {
    console.log('🔄 Manual sync triggered');
    return processPendingUploads();
};

export default {
    subscribeSyncStatus,
    processPendingUploads,
    retryUpload,
    cancelUpload,
    getSyncStatus,
    isSyncInProgress,
    triggerSync,
};
