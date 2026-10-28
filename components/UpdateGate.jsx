import { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE_URL } from '../constants/config';
import { AppColors } from '../constants/theme';

/**
 * Compare two dotted version strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
const compareVersions = (a, b) => {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x < y) return -1;
        if (x > y) return 1;
    }
    return 0;
};

/**
 * Admin-controlled update gate. On launch it fetches /config/app and compares
 * the installed version against the admin-configured min/latest versions:
 *  - below min_supported_version (or force_update on) -> blocking dialog
 *  - below latest_version        -> dismissible "update available" dialog
 * A failed check never blocks the app.
 */
export default function UpdateGate() {
    const [config, setConfig] = useState(null);
    const [mode, setMode] = useState(null); // 'force' | 'optional' | null
    const [dismissed, setDismissed] = useState(false);

    const currentVersion =
        Constants.expoConfig?.version || Constants.manifest?.version || '0.0.0';

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/public/config/app`);
                const json = await res.json();
                const data = json?.data || json;
                if (!active || !data) return;
                setConfig(data);

                const belowMin = compareVersions(currentVersion, data.min_supported_version) < 0;
                const belowLatest = compareVersions(currentVersion, data.latest_version) < 0;

                if (belowMin || (data.force_update && belowLatest)) {
                    setMode('force');
                } else if (belowLatest) {
                    setMode('optional');
                }
            } catch (e) {
                // Never block the app if the version check fails (offline, etc.)
                console.log('Update check skipped:', e.message);
            }
        })();
        return () => { active = false; };
    }, []);

    const openStore = () => {
        const url = Platform.OS === 'ios' ? config?.ios_store_url : config?.android_store_url;
        if (url) Linking.openURL(url).catch(() => { });
    };

    const isForce = mode === 'force';
    const visible = !!mode && !(mode === 'optional' && dismissed);
    if (!visible) return null;

    return (
        <Modal
            visible
            transparent
            animationType="fade"
            // Android back button: ignore when forced, dismiss when optional
            onRequestClose={() => { if (!isForce) setDismissed(true); }}
        >
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <Text style={styles.icon}>🚀</Text>
                    <Text style={styles.title}>{config?.update_title || 'Update Available'}</Text>
                    <Text style={styles.message}>
                        {config?.update_message ||
                            'A new version of ClaimsMitra is available. Please update to continue.'}
                    </Text>

                    <TouchableOpacity style={styles.updateBtn} onPress={openStore} activeOpacity={0.85}>
                        <Text style={styles.updateText}>Update Now</Text>
                    </TouchableOpacity>

                    {!isForce && (
                        <TouchableOpacity style={styles.laterBtn} onPress={() => setDismissed(true)}>
                            <Text style={styles.laterText}>Later</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    card: {
        width: '100%',
        maxWidth: 360,
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 24,
        alignItems: 'center',
    },
    icon: {
        fontSize: 44,
        marginBottom: 8,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1A1A1A',
        textAlign: 'center',
        marginBottom: 8,
    },
    message: {
        fontSize: 14,
        lineHeight: 20,
        color: '#666',
        textAlign: 'center',
        marginBottom: 20,
    },
    updateBtn: {
        width: '100%',
        backgroundColor: AppColors.primary,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    updateText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '700',
    },
    laterBtn: {
        marginTop: 12,
        paddingVertical: 8,
    },
    laterText: {
        color: '#999',
        fontSize: 14,
        fontWeight: '600',
    },
});
