/**
 * Media Utilities for Inspection Screen
 * Provides image/video compression and watermarking functionality
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { Video } from 'react-native-compressor';

/**
 * Compress an image to be under the specified max size (in KB)
 * Uses iterative quality reduction to achieve target size
 * 
 * @param {string} uri - The image URI to compress
 * @param {number} maxSizeKB - Maximum file size in KB (default: 300)
 * @returns {Promise<string>} - The compressed image URI
 */
export async function compressImage(uri, maxSizeKB = 300) {
    const maxSizeBytes = maxSizeKB * 1024;

    // First check if already under limit
    const originalInfo = await FileSystem.getInfoAsync(uri);
    if (originalInfo.size && originalInfo.size <= maxSizeBytes) {
        console.log(`Image already under ${maxSizeKB}KB (${Math.round(originalInfo.size / 1024)}KB)`);
        return uri;
    }

    // Start with quality 0.8 and reduce iteratively
    let quality = 0.8;
    let compressedUri = uri;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
        const result = await ImageManipulator.manipulateAsync(
            uri,
            [], // No transformations, just compress
            {
                compress: quality,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        );

        compressedUri = result.uri;
        const info = await FileSystem.getInfoAsync(compressedUri);

        console.log(`Compression attempt ${attempts + 1}: quality=${quality.toFixed(2)}, size=${Math.round(info.size / 1024)}KB`);

        if (info.size && info.size <= maxSizeBytes) {
            console.log(`Successfully compressed to ${Math.round(info.size / 1024)}KB`);
            return compressedUri;
        }

        // Reduce quality for next attempt
        quality -= 0.15;
        if (quality < 0.1) quality = 0.1;
        attempts++;
    }

    // Return best attempt even if over limit
    console.log(`Could not compress to ${maxSizeKB}KB after ${maxAttempts} attempts, using best result`);
    return compressedUri;
}

/**
 * Compress a video using WhatsApp-like compression
 * 
 * @param {string} uri - The video URI to compress
 * @returns {Promise<string>} - The compressed video URI
 */
export async function compressVideo(uri) {
    try {
        console.log('Starting video compression...');

        // Get original size for comparison
        const originalInfo = await FileSystem.getInfoAsync(uri);
        console.log(`Original video size: ${Math.round(originalInfo.size / (1024 * 1024))}MB`);

        // Use automatic compression (WhatsApp-like)
        const compressedUri = await Video.compress(uri, {
            compressionMethod: 'auto',
        });

        const compressedInfo = await FileSystem.getInfoAsync(compressedUri);
        console.log(`Compressed video size: ${Math.round(compressedInfo.size / (1024 * 1024))}MB`);

        const reduction = Math.round((1 - (compressedInfo.size / originalInfo.size)) * 100);
        console.log(`Video compression: ${reduction}% size reduction`);

        return compressedUri;
    } catch (error) {
        console.error('Video compression failed:', error);
        // Return original if compression fails
        return uri;
    }
}

/**
 * Format location coordinates for watermark display
 * Uses reverse geocoding to get actual address
 * 
 * @param {object} location - Location object with latitude and longitude
 * @returns {Promise<string>} - Formatted address string
 */
export async function formatLocationForWatermark(location) {
    if (!location || (!location.latitude && !location.longitude)) {
        return 'Location unavailable';
    }

    try {
        // Import Location dynamically to avoid circular dependencies
        const Location = require('expo-location');

        const addresses = await Location.reverseGeocodeAsync({
            latitude: location.latitude,
            longitude: location.longitude
        });

        if (addresses && addresses.length > 0) {
            const addr = addresses[0];
            // Build a readable address string
            const parts = [];

            if (addr.name && addr.name !== addr.street) parts.push(addr.name);
            if (addr.street) parts.push(addr.street);
            if (addr.district) parts.push(addr.district);
            if (addr.city) parts.push(addr.city);
            if (addr.region) parts.push(addr.region);

            // If we have address parts, return them
            if (parts.length > 0) {
                // Limit to 2-3 parts for watermark
                return parts.slice(0, 3).join(', ');
            }
        }
    } catch (error) {
        console.log('Reverse geocoding failed:', error);
    }

    // Fallback to coordinates if geocoding fails
    const lat = location.latitude?.toFixed(6) || '0';
    const lng = location.longitude?.toFixed(6) || '0';
    return `${lat}, ${lng}`;
}

/**
 * Format current timestamp for watermark display
 * 
 * @returns {string} - Formatted timestamp string (e.g., "22/01/2026 13:45:30")
 */
export function formatTimestampForWatermark() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

/**
 * Process a photo for upload: apply watermark (if camera) and compress
 * 
 * @param {string} uri - The photo URI
 * @param {object} location - Location object with latitude and longitude
 * @param {string} source - 'camera' or 'gallery'
 * @param {object} viewShotRef - Reference to ViewShot component (required for watermarking)
 * @returns {Promise<{uri: string, timestamp: string}>} - Processed image URI and timestamp
 */
export async function processPhotoForUpload(uri, location, source, viewShotRef = null) {
    const timestamp = formatTimestampForWatermark();
    let processedUri = uri;

    // Only apply watermark for camera-captured photos
    if (source === 'camera' && viewShotRef && viewShotRef.current) {
        try {
            // Capture the ViewShot component which contains image + overlay
            processedUri = await viewShotRef.current.capture();
            console.log('Watermark applied successfully');
        } catch (error) {
            console.error('Watermark failed, using original:', error);
        }
    }

    // Always compress
    const compressedUri = await compressImage(processedUri, 300);

    return { uri: compressedUri, timestamp };
}

/**
 * Add date/time and address watermark to a video using FFmpeg.
 * Uses ffmpeg-kit-react-native; Android resolves full-gpl from Appodeal Artifactory.
 *
 * @param {string} uri - Video file URI
 * @param {string} timestamp - e.g. "22/01/2026 13:45:30"
 * @param {string} address - e.g. "Street, City" or "lat, lng"
 * @returns {Promise<string>} - Watermarked video URI, or original on skip/failure
 */
export async function addVideoWatermark(uri, timestamp, address) {
    if (Platform.OS === 'web') {
        return uri;
    }

    let FFmpegKit;
    let ReturnCode;
    let FFmpegKitConfig;
    /*
    try {
        const ffmpeg = require('ffmpeg-kit-react-native');
        FFmpegKit = ffmpeg.FFmpegKit;
        ReturnCode = ffmpeg.ReturnCode;
        FFmpegKitConfig = ffmpeg.FFmpegKitConfig;
    } catch (e) {
        console.warn('FFmpeg not available, skipping video watermark:', e?.message);
        return uri;
    }
    */
    console.warn('Video watermarking disabled due to ffmpeg-kit retirement');
    return uri;

    try {
        const fontDirs = Platform.OS === 'android'
            ? ['/system/fonts']
            : ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental'];
        await FFmpegKitConfig?.setFontDirectoryList?.(fontDirs);
    } catch (e) {
        console.warn('FFmpeg font config skipped:', e?.message);
    }

    const fs = FileSystem;
    const baseDir = `${fs.cacheDirectory}watermark/`;
    const inputPath = uri.startsWith('file://') ? uri.replace('file://', '') : uri;
    const prefix = `wm_${Date.now()}_`;
    const timestampFile = `${baseDir}${prefix}ts.txt`;
    const addressFile = `${baseDir}${prefix}addr.txt`;
    const outputPath = `${baseDir}${prefix}out.mp4`;

    try {
        await fs.makeDirectoryAsync(baseDir, { intermediates: true });
    } catch {
        /* already exists */
    }

    try {
        const safeTimestamp = String(timestamp || '').replace(/\r?\n/g, ' ').trim() || '–';
        const safeAddress = String(address || 'Location unavailable').replace(/\r?\n/g, ' ').trim();

        await fs.writeAsStringAsync(timestampFile, safeTimestamp, { encoding: fs.EncodingType.UTF8 });
        await fs.writeAsStringAsync(addressFile, `📍 ${safeAddress}`, { encoding: fs.EncodingType.UTF8 });
    } catch (e) {
        console.error('Failed to write watermark text files:', e);
        return uri;
    }

    const tsPath = timestampFile.startsWith('file://') ? timestampFile.replace('file://', '') : timestampFile;
    const addrPath = addressFile.startsWith('file://') ? addressFile.replace('file://', '') : addressFile;
    const outPath = outputPath.startsWith('file://') ? outputPath.replace('file://', '') : outputPath;

    const draw1 = `drawtext=textfile='${tsPath}':x=(w-tw-10):y=(h-th-50):fontsize=20:fontcolor=white:borderw=2:box=1:boxcolor=black@0.6:boxborderw=5`;
    const draw2 = `drawtext=textfile='${addrPath}':x=(w-tw-10):y=(h-th-20):fontsize=16:fontcolor=white:borderw=2:box=1:boxcolor=black@0.6:boxborderw=5`;
    const filter = `"${draw1},${draw2}"`;
    const command = `-y -i "${inputPath}" -vf ${filter} -c:v libx264 -crf 18 -preset fast -c:a copy "${outPath}"`;

    try {
        const session = await FFmpegKit.execute(command);
        const returnCode = await session.getReturnCode();
        if (!ReturnCode.isSuccess(returnCode)) {
            console.warn('FFmpeg watermark failed, returnCode:', returnCode);
            return uri;
        }
        return outputPath.startsWith('file://') ? outputPath : `file://${outPath}`;
    } catch (e) {
        console.error('FFmpeg watermark error:', e);
        return uri;
    } finally {
        try {
            await fs.deleteAsync(timestampFile, { idempotent: true });
            await fs.deleteAsync(addressFile, { idempotent: true });
        } catch {
            /* ignore */
        }
    }
}

/**
 * Process a video for upload.
 * Camera: compress first, then add watermark (high-quality encode). No second compression —
 * prevents watermark from getting blurred.
 * Gallery: compress only.
 *
 * @param {string} uri - The video URI
 * @param {string} source - 'camera' or 'gallery'
 * @param {object} [location] - { latitude, longitude } for address watermark (camera only)
 * @returns {Promise<string>} - Processed video URI
 */
export async function processVideoForUpload(uri, source, location = null) {
    if (source === 'camera') {
        const compressedUri = await compressVideo(uri);
        const timestamp = formatTimestampForWatermark();
        const address = location
            ? await formatLocationForWatermark(location)
            : 'Location unavailable';
        return addVideoWatermark(compressedUri, timestamp, address);
    }
    return compressVideo(uri);
}

/**
 * Watermark overlay component styles
 * Used by the parent component when rendering watermark overlay
 */
export const watermarkStyles = {
    container: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: 8,
    },
    text: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    locationText: {
        color: 'white',
        fontSize: 10,
        textAlign: 'center',
        marginTop: 2,
    },
};
