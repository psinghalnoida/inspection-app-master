/**
 * In-app sound playback for notification tones.
 * Used to play a tone when a new survey broadcast arrives while the app is in the foreground.
 *
 * The "survey alert" can be played either as a one-shot or as a continuous loop that keeps
 * ringing until the surveyor accepts/declines the broadcast (mimicking a ringtone).
 */

import { Audio } from 'expo-av';

let cachedSound = null;
let loading = false;
let isLooping = false;

async function ensureAudioMode() {
    try {
        await Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            // While ringing for a survey request we don't want to be ducked under other audio —
            // use DO_NOT_MIX so the alert is clearly audible.
            shouldDuckAndroid: false,
            interruptionModeAndroid: 2, // DO_NOT_MIX
            interruptionModeIOS: 2,     // DO_NOT_MIX
        });
    } catch (err) {
        // Non-fatal; playback can still proceed with default mode
        console.warn('Audio.setAudioModeAsync failed:', err?.message);
    }
}

async function loadSurveyAlert() {
    if (cachedSound || loading) return cachedSound;
    loading = true;
    try {
        await ensureAudioMode();
        // The asset must exist at assets/sounds/survey_alert.mp3.
        // See assets/sounds/README.md for details.
        const source = require('../assets/sounds/survey_alert.mp3');
        const { sound } = await Audio.Sound.createAsync(source, {
            shouldPlay: false,
            volume: 1.0,
        });
        cachedSound = sound;
        return sound;
    } catch (err) {
        console.warn('Could not load survey alert sound:', err?.message);
        return null;
    } finally {
        loading = false;
    }
}

export async function playSurveyAlertSound() {
    try {
        const sound = await loadSurveyAlert();
        if (!sound) return;
        await sound.setIsLoopingAsync(false);
        isLooping = false;
        await sound.setPositionAsync(0);
        await sound.playAsync();
    } catch (err) {
        console.warn('Could not play survey alert sound:', err?.message);
    }
}

/**
 * Start playing the survey alert on a continuous loop.
 * Idempotent — calling it again while already looping is a no-op.
 * Use stopSurveyAlertSound() to stop it (e.g. when the surveyor accepts/declines).
 */
export async function startSurveyAlertLoop() {
    try {
        const sound = await loadSurveyAlert();
        if (!sound) return;
        if (isLooping) {
            // Already ringing — make sure it's actually playing in case it was paused.
            const status = await sound.getStatusAsync();
            if (status?.isLoaded && !status.isPlaying) {
                await sound.playAsync();
            }
            return;
        }
        await sound.setIsLoopingAsync(true);
        await sound.setPositionAsync(0);
        await sound.setVolumeAsync(1.0);
        await sound.playAsync();
        isLooping = true;
    } catch (err) {
        console.warn('Could not start survey alert loop:', err?.message);
    }
}

/**
 * Stop any ongoing survey alert playback (one-shot or loop).
 */
export async function stopSurveyAlertSound() {
    try {
        if (!cachedSound) return;
        const status = await cachedSound.getStatusAsync();
        if (status?.isLoaded) {
            await cachedSound.stopAsync();
            await cachedSound.setIsLoopingAsync(false);
        }
    } catch (err) {
        console.warn('Could not stop survey alert sound:', err?.message);
    } finally {
        isLooping = false;
    }
}

export function isSurveyAlertLooping() {
    return isLooping;
}

export async function unloadSurveyAlertSound() {
    if (cachedSound) {
        try {
            await cachedSound.unloadAsync();
        } catch {
            // ignore
        }
        cachedSound = null;
        isLooping = false;
    }
}

export default {
    playSurveyAlertSound,
    startSurveyAlertLoop,
    stopSurveyAlertSound,
    isSurveyAlertLooping,
    unloadSurveyAlertSound,
};
