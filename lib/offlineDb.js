/**
 * Offline Database Service
 * SQLite database for caching surveys and queuing offline uploads
 */

import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';

let db = null;
let isInitializing = false;

/**
 * Initialize the database and create tables
 */
export const initDatabase = async () => {
    if (isInitializing) return false;
    isInitializing = true;

    try {
        if (db) {
            isInitializing = false;
            return true;
        }

        db = await SQLite.openDatabaseAsync('claimsmitra_offline');

        // Create cached_surveys table
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS cached_surveys (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                cached_at INTEGER NOT NULL
            );
        `);

        // Create cached_survey_details table
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS cached_survey_details (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                cached_at INTEGER NOT NULL
            );
        `);

        // Create pending_uploads table
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS pending_uploads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                survey_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                file_uri TEXT NOT NULL,
                metadata TEXT,
                status TEXT DEFAULT 'pending',
                retry_count INTEGER DEFAULT 0,
                error_message TEXT,
                created_at INTEGER NOT NULL
            );
        `);

        // Create sync_status table for tracking last sync
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS sync_status (
                id INTEGER PRIMARY KEY DEFAULT 1,
                last_sync_at INTEGER,
                is_syncing INTEGER DEFAULT 0
            );
        `);

        // Drafts of in-progress inspections: lets surveyors back out of the
        // capture screen without losing photos/videos/notes they haven't
        // uploaded yet. Keyed by (survey_id, mode) so 'start' and 'add_photos'
        // can coexist.
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS inspection_drafts (
                survey_id INTEGER NOT NULL,
                mode TEXT NOT NULL DEFAULT 'start',
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (survey_id, mode)
            );
        `);

        console.log('✅ Offline database initialized');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize offline database:', error);
        db = null;
        return false;
    } finally {
        isInitializing = false;
    }
};

/**
 * Ensure database is connected before operation
 */
const ensureDb = async () => {
    if (!db) {
        await initDatabase();
    }
    if (!db) throw new Error('Offline database not available');
    return db;
};

/**
 * Get database instance
 */
export const getDb = () => db;

// ==================== SURVEY CACHING ====================

/**
 * Cache survey list
 */
export const cacheSurveys = async (surveys) => {
    if (!surveys || !Array.isArray(surveys)) return;

    try {
        const activeDb = await ensureDb();
        const now = Date.now();

        // Clear old cache and insert new surveys in a batch-like way
        // Transaction would be better here for consistency
        await activeDb.withTransactionAsync(async () => {
            await activeDb.execAsync('DELETE FROM cached_surveys');
            
            for (const survey of surveys) {
                if (!survey || !survey.id) continue;
                await activeDb.runAsync(
                    'INSERT OR REPLACE INTO cached_surveys (id, data, cached_at) VALUES (?, ?, ?)',
                    [survey.id, JSON.stringify(survey), now]
                );
            }
        });

        console.log(`📦 Cached ${surveys.length} surveys`);
    } catch (error) {
        console.error('Error caching surveys:', error);
    }
};

/**
 * Get cached surveys
 */
export const getCachedSurveys = async () => {
    try {
        const activeDb = await ensureDb();
        const result = await activeDb.getAllAsync('SELECT data FROM cached_surveys');
        return result.map(row => JSON.parse(row.data));
    } catch (error) {
        console.error('Error getting cached surveys:', error);
        return [];
    }
};

/**
 * Cache survey details
 */
export const cacheSurveyDetail = async (surveyId, surveyData) => {
    if (!surveyData) return;

    try {
        const activeDb = await ensureDb();
        const now = Date.now();
        await activeDb.runAsync(
            'INSERT OR REPLACE INTO cached_survey_details (id, data, cached_at) VALUES (?, ?, ?)',
            [surveyId, JSON.stringify(surveyData), now]
        );
        console.log(`📦 Cached survey details for ID: ${surveyId}`);
    } catch (error) {
        console.error('Error caching survey detail:', error);
    }
};

/**
 * Get cached survey details
 */
export const getCachedSurveyDetail = async (surveyId) => {
    try {
        const activeDb = await ensureDb();
        const result = await activeDb.getFirstAsync(
            'SELECT data FROM cached_survey_details WHERE id = ?',
            [surveyId]
        );
        return result ? JSON.parse(result.data) : null;
    } catch (error) {
        console.error('Error getting cached survey detail:', error);
        return null;
    }
};

// ==================== PENDING UPLOADS ====================

/**
 * Queue a media upload for later sync
 */
export const queueUpload = async (surveyId, type, fileUri, metadata = {}) => {
    try {
        const activeDb = await ensureDb();
        // Copy file to app's document directory to persist it
        const fileName = `offline_${type}_${surveyId}_${Date.now()}${getFileExtension(fileUri)}`;
        const localUri = `${FileSystem.documentDirectory}pending_uploads/${fileName}`;

        // Ensure directory exists
        await FileSystem.makeDirectoryAsync(
            `${FileSystem.documentDirectory}pending_uploads/`,
            { intermediates: true }
        ).catch(() => { });

        // Copy the file
        await FileSystem.copyAsync({
            from: fileUri,
            to: localUri
        });

        const now = Date.now();
        
        const result = await activeDb.runAsync(
            `INSERT INTO pending_uploads (survey_id, type, file_uri, metadata, status, created_at) 
             VALUES (?, ?, ?, ?, 'pending', ?)`,
            [surveyId, type, localUri, JSON.stringify(metadata), now]
        );

        console.log(`📤 Queued ${type} upload for survey ${surveyId}`);
        return result.lastInsertRowId;
    } catch (error) {
        console.error('Error queueing upload:', error);
        return null;
    }
};

/**
 * Queue a notes update for later sync. Unlike media uploads there's no file
 * to copy — we just persist the text + session number in metadata and use a
 * sentinel file_uri so the existing pending_uploads schema is reusable.
 */
export const queueNotes = async (surveyId, sessionNumber, notes) => {
    try {
        const activeDb = await ensureDb();
        const now = Date.now();
        const result = await activeDb.runAsync(
            `INSERT INTO pending_uploads (survey_id, type, file_uri, metadata, status, created_at)
             VALUES (?, 'notes', '', ?, 'pending', ?)`,
            [surveyId, JSON.stringify({ sessionNumber, notes }), now]
        );
        console.log(`📤 Queued notes for survey ${surveyId} (session ${sessionNumber})`);
        return result.lastInsertRowId;
    } catch (error) {
        console.error('Error queueing notes:', error);
        return null;
    }
};

/**
 * Get all pending uploads
 */
export const getPendingUploads = async () => {
    if (!db) return [];

    try {
        const result = await db.getAllAsync(
            "SELECT * FROM pending_uploads WHERE status = 'pending' OR status = 'failed' ORDER BY created_at ASC"
        );
        return result.map(row => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : {}
        }));
    } catch (error) {
        console.error('Error getting pending uploads:', error);
        return [];
    }
};

/**
 * Get pending uploads count
 */
export const getPendingUploadsCount = async () => {
    try {
        const activeDb = await ensureDb();
        const result = await activeDb.getFirstAsync(
            "SELECT COUNT(*) as count FROM pending_uploads WHERE status = 'pending' OR status = 'failed'"
        );
        return result?.count || 0;
    } catch (error) {
        console.error('Error getting pending uploads count:', error);
        return 0;
    }
};

/**
 * Get pending uploads for a specific survey
 */
export const getPendingUploadsForSurvey = async (surveyId) => {
    if (!db) return [];

    try {
        const result = await db.getAllAsync(
            "SELECT * FROM pending_uploads WHERE survey_id = ? AND (status = 'pending' OR status = 'failed')",
            [surveyId]
        );
        return result.map(row => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : {}
        }));
    } catch (error) {
        console.error('Error getting pending uploads for survey:', error);
        return [];
    }
};

/**
 * Update upload status
 */
export const updateUploadStatus = async (uploadId, status, errorMessage = null) => {
    try {
        const activeDb = await ensureDb();
        if (status === 'failed') {
            await activeDb.runAsync(
                'UPDATE pending_uploads SET status = ?, retry_count = retry_count + 1, error_message = ? WHERE id = ?',
                [status, errorMessage, uploadId]
            );
        } else {
            await activeDb.runAsync(
                'UPDATE pending_uploads SET status = ?, error_message = NULL WHERE id = ?',
                [status, uploadId]
            );
        }
    } catch (error) {
        console.error('Error updating upload status:', error);
    }
};

/**
 * Remove completed upload
 */
export const removeCompletedUpload = async (uploadId) => {
    try {
        const activeDb = await ensureDb();
        // Get the file URI first
        const upload = await activeDb.getFirstAsync(
            'SELECT file_uri FROM pending_uploads WHERE id = ?',
            [uploadId]
        );

        // Delete the file
        if (upload?.file_uri) {
            await FileSystem.deleteAsync(upload.file_uri, { idempotent: true });
        }

        // Remove from database
        await activeDb.runAsync('DELETE FROM pending_uploads WHERE id = ?', [uploadId]);
        console.log(`🗑️ Removed completed upload: ${uploadId}`);
    } catch (error) {
        console.error('Error removing completed upload:', error);
    }
};

/**
 * Clear all pending uploads for a survey (e.g., after successful batch sync)
 */
export const clearPendingUploadsForSurvey = async (surveyId) => {
    if (!db) return;

    try {
        // Get all uploads for survey
        const uploads = await db.getAllAsync(
            'SELECT file_uri FROM pending_uploads WHERE survey_id = ?',
            [surveyId]
        );

        // Delete files
        for (const upload of uploads) {
            if (upload.file_uri) {
                await FileSystem.deleteAsync(upload.file_uri, { idempotent: true });
            }
        }

        // Remove from database
        await db.runAsync('DELETE FROM pending_uploads WHERE survey_id = ?', [surveyId]);
    } catch (error) {
        console.error('Error clearing pending uploads:', error);
    }
};

// ==================== SYNC STATUS ====================

/**
 * Update sync status
 */
export const updateSyncStatus = async (isSyncing) => {
    if (!db) return;

    try {
        await db.runAsync(
            'INSERT OR REPLACE INTO sync_status (id, last_sync_at, is_syncing) VALUES (1, ?, ?)',
            [Date.now(), isSyncing ? 1 : 0]
        );
    } catch (error) {
        console.error('Error updating sync status:', error);
    }
};

/**
 * Get sync status
 */
export const getSyncStatus = async () => {
    if (!db) return { lastSyncAt: null, isSyncing: false };

    try {
        const result = await db.getFirstAsync('SELECT * FROM sync_status WHERE id = 1');
        return {
            lastSyncAt: result?.last_sync_at ? new Date(result.last_sync_at) : null,
            isSyncing: result?.is_syncing === 1
        };
    } catch (error) {
        console.error('Error getting sync status:', error);
        return { lastSyncAt: null, isSyncing: false };
    }
};

// ==================== INSPECTION DRAFTS ====================

const DRAFT_DIR = `${FileSystem.documentDirectory}inspection_drafts/`;

const draftDirFor = (surveyId, mode) => `${DRAFT_DIR}${surveyId}_${mode}/`;

/**
 * Copy a transient capture (cache-dir URI from camera/gallery/compression)
 * into the persistent draft directory so the file survives app restart and
 * cache eviction. Returns the new persistent URI.
 */
export const persistDraftMedia = async (surveyId, mode, sourceUri, kind) => {
    const dir = draftDirFor(surveyId, mode);
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => { });
    const ext = getFileExtension(sourceUri) || (kind === 'video' ? '.mp4' : '.jpg');
    const fileName = `${kind}_${Date.now()}_${Math.floor(Math.random() * 1e6)}${ext}`;
    const destUri = `${dir}${fileName}`;
    await FileSystem.copyAsync({ from: sourceUri, to: destUri });
    return destUri;
};

/**
 * Best-effort deletion of a single draft file (used when user removes a
 * photo/video before uploading).
 */
export const deleteDraftFile = async (uri) => {
    if (!uri || typeof uri !== 'string') return;
    if (!uri.startsWith(DRAFT_DIR)) return;
    try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (error) {
        console.log('deleteDraftFile failed:', error?.message);
    }
};

/**
 * Save the in-progress inspection draft for a survey + mode. Stores raw
 * state (selfie/photos/videos/notes/currentStep) — files referenced in the
 * URIs must already live in the draft directory (use persistDraftMedia).
 */
export const saveInspectionDraft = async (surveyId, mode, draftData) => {
    if (!surveyId) return;
    try {
        const activeDb = await ensureDb();
        await activeDb.runAsync(
            `INSERT OR REPLACE INTO inspection_drafts (survey_id, mode, data, updated_at)
             VALUES (?, ?, ?, ?)`,
            [surveyId, mode, JSON.stringify(draftData), Date.now()]
        );
    } catch (error) {
        console.error('Error saving inspection draft:', error);
    }
};

export const getInspectionDraft = async (surveyId, mode) => {
    if (!surveyId) return null;
    try {
        const activeDb = await ensureDb();
        const row = await activeDb.getFirstAsync(
            'SELECT data FROM inspection_drafts WHERE survey_id = ? AND mode = ?',
            [surveyId, mode]
        );
        return row ? JSON.parse(row.data) : null;
    } catch (error) {
        console.error('Error reading inspection draft:', error);
        return null;
    }
};

export const clearInspectionDraft = async (surveyId, mode) => {
    if (!surveyId) return;
    try {
        const activeDb = await ensureDb();
        await activeDb.runAsync(
            'DELETE FROM inspection_drafts WHERE survey_id = ? AND mode = ?',
            [surveyId, mode]
        );
        await FileSystem.deleteAsync(draftDirFor(surveyId, mode), { idempotent: true });
    } catch (error) {
        console.error('Error clearing inspection draft:', error);
    }
};

// ==================== UTILITIES ====================

/**
 * Get file extension from URI
 */
const getFileExtension = (uri) => {
    const match = uri.match(/\.([^.]+)$/);
    return match ? `.${match[1]}` : '';
};

/**
 * Clear all cached data (for logout)
 */
export const clearAllCache = async () => {
    try {
        const activeDb = await ensureDb();
        await activeDb.execAsync('DELETE FROM cached_surveys');
        await activeDb.execAsync('DELETE FROM cached_survey_details');

        // Also clear pending uploads directory
        await FileSystem.deleteAsync(
            `${FileSystem.documentDirectory}pending_uploads/`,
            { idempotent: true }
        );
        await activeDb.execAsync('DELETE FROM pending_uploads');

        // Clear inspection drafts (in-progress capture state)
        await FileSystem.deleteAsync(DRAFT_DIR, { idempotent: true });
        await activeDb.execAsync('DELETE FROM inspection_drafts');

        console.log('🗑️ Cleared all offline cache');
    } catch (error) {
        console.error('Error clearing cache:', error);
    }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async () => {
    if (!db) return { surveys: 0, details: 0, pendingUploads: 0 };

    try {
        const surveys = await db.getFirstAsync('SELECT COUNT(*) as count FROM cached_surveys');
        const details = await db.getFirstAsync('SELECT COUNT(*) as count FROM cached_survey_details');
        const pending = await db.getFirstAsync('SELECT COUNT(*) as count FROM pending_uploads WHERE status != "completed"');

        return {
            surveys: surveys?.count || 0,
            details: details?.count || 0,
            pendingUploads: pending?.count || 0
        };
    } catch (error) {
        console.error('Error getting cache stats:', error);
        return { surveys: 0, details: 0, pendingUploads: 0 };
    }
};

export default {
    initDatabase,
    getDb,
    // Survey caching
    cacheSurveys,
    getCachedSurveys,
    cacheSurveyDetail,
    getCachedSurveyDetail,
    // Pending uploads
    queueUpload,
    queueNotes,
    getPendingUploads,
    getPendingUploadsCount,
    getPendingUploadsForSurvey,
    updateUploadStatus,
    removeCompletedUpload,
    clearPendingUploadsForSurvey,
    // Sync status
    updateSyncStatus,
    getSyncStatus,
    // Inspection drafts
    persistDraftMedia,
    deleteDraftFile,
    saveInspectionDraft,
    getInspectionDraft,
    clearInspectionDraft,
    // Utilities
    clearAllCache,
    getCacheStats,
};
