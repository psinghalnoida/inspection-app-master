/**
 * Notification Screen
 * Shows in-app notifications for both surveyor and assigner
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors } from '../constants/theme';
import {
    getNotifications,
    markAllNotificationsAsRead,
    markNotificationAsRead,
} from '../lib/notifications';
import socketService from '../lib/socket';
import api from '../lib/api';

// Notification type icons
const getNotificationIcon = (type) => {
    const icons = {
        survey_created: 'assignment',
        survey_assigned: 'person-add',
        survey_started: 'directions-car',
        surveyor_arrived: 'location-on',
        report_submitted: 'description',
        report_accepted: 'check-circle',
        report_rejected: 'error',
        payment_received: 'payment',
        payment_completed: 'play-circle-filled',
        payment_released: 'account-balance-wallet',
        new_chat_message: 'chat',
        broadcast_request: 'notifications-active',
        broadcast_expired: 'timer-off',
        employee_invite: 'group-add',
        employee_invite_response: 'people',
        bill_issued: 'receipt-long',
        bill_settled: 'task-alt',
        system: 'info',
        other: 'notifications',
    };
    return icons[type] || 'notifications';
};

// Notification type colors
const getNotificationColor = (type) => {
    const colors = {
        survey_created: '#7C3AED',
        survey_assigned: '#10B981',
        survey_started: '#3B82F6',
        surveyor_arrived: '#7C3AED',
        report_submitted: '#8B5CF6',
        report_accepted: '#10B981',
        report_rejected: '#EF4444',
        payment_received: '#10B981',
        payment_completed: '#10B981',
        payment_released: '#10B981',
        new_chat_message: '#3B82F6',
        broadcast_request: '#F59E0B',
        broadcast_expired: '#6B7280',
        employee_invite: '#F59E0B',
        employee_invite_response: '#3B82F6',
        // An issued invoice needs action (amber, like other "respond to this"
        // types); a settled one is informational.
        bill_issued: '#F59E0B',
        bill_settled: '#10B981',
        system: '#6B7280',
        other: '#6B7280',
    };
    return colors[type] || '#6B7280';
};

// Format time ago
const formatTimeAgo = (dateString) => {
    if (!dateString) return '';

    // Parse the date - ensure it's treated as UTC if no timezone specified
    let date;
    if (typeof dateString === 'string' && !dateString.includes('Z') && !dateString.includes('+')) {
        // If no timezone info, assume UTC
        date = new Date(dateString + 'Z');
    } else {
        date = new Date(dateString);
    }

    // Use Date.now() for current timestamp (always accurate)
    const nowMs = Date.now();
    const dateMs = date.getTime();

    // Check for invalid date
    if (isNaN(dateMs)) return '';

    const diffMs = nowMs - dateMs;

    // Handle future dates (shouldn't happen but just in case)
    if (diffMs < 0) return 'Just now';

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
};

const TIME_OPTIONS = [
    { label: 'Now (Immediately)', value: '0' },
    { label: '30 Minutes', value: '30' },
    { label: '1 Hour', value: '60' },
    { label: '2 Hours', value: '120' },
    { label: '6 Hours', value: '360' },
    { label: '12 Hours', value: '720' },
    { label: 'Next Day (24h)', value: '1440' },
];

export default function NotificationScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Accept/Decline Modal state
    const [acceptModalVisible, setAcceptModalVisible] = useState(false);
    const [selectedNotification, setSelectedNotification] = useState(null);
    const [etaText, setEtaText] = useState('0');
    const [accepting, setAccepting] = useState(false);

    const fetchNotifications = async () => {
        try {
            const data = await getNotifications({ limit: 50 });
            setNotifications(data.notifications || []);
            setUnreadCount(data.unread_count || 0);
        } catch (error) {
            console.error('Error fetching notifications:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchNotifications();

        let unsubscribeNew = null;
        let unsubscribeUnread = null;
        let unsubscribeExpired = null;

        const connectSocket = async () => {
            // Ensure socket is connected
            await socketService.connect();

            // Listen for new notifications
            unsubscribeNew = socketService.onNewNotification((newNotif) => {
                setNotifications(prev => {
                    // Avoid duplicates
                    if (prev.some(n => n.id === newNotif.id)) return prev;
                    return [newNotif, ...prev];
                });
            });

            // Listen for unread count updates
            unsubscribeUnread = socketService.onUnreadCount((count) => {
                setUnreadCount(count);
            });

            // Broadcast closed (assigned/expired): drop its request card immediately
            unsubscribeExpired = socketService.onNotificationExpired((expiredData) => {
                const sid = String(expiredData?.survey_id);
                setNotifications(prev => {
                    const removedUnread = prev.filter(n =>
                        n.notification_type === 'broadcast_request' &&
                        String(n.reference_id) === sid &&
                        !n.is_read
                    ).length;
                    if (removedUnread > 0) {
                        setUnreadCount(c => Math.max(0, c - removedUnread));
                    }
                    return prev.filter(n =>
                        !(n.notification_type === 'broadcast_request' && String(n.reference_id) === sid)
                    );
                });
            });
        };

        connectSocket();

        return () => {
            if (unsubscribeNew) unsubscribeNew();
            if (unsubscribeUnread) unsubscribeUnread();
            if (unsubscribeExpired) unsubscribeExpired();
        };
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchNotifications();
    }, []);

    const handleNotificationPress = async (notification) => {
        // Mark as read
        if (!notification.is_read) {
            await markNotificationAsRead(notification.id);
            setNotifications(prev =>
                prev.map(n => n.id === notification.id ? { ...n, is_read: true } : n)
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
        }

        // For broadcast_request, show accept/decline modal — but only while still
        // open. A read broadcast_request means the broadcast already closed
        // (assigned to someone else or expired), so don't offer accept/decline.
        if (notification.notification_type === 'broadcast_request') {
            if (notification.is_read) {
                Alert.alert('Request Closed', 'This survey request is no longer available.');
                return;
            }
            setSelectedNotification(notification);
            setEtaText('0');
            setAcceptModalVisible(true);
            return;
        }

        // A team invitation is answered on the surveyor's own profile, where the
        // consequence of accepting is spelled out before they commit.
        if (notification.notification_type === 'employee_invite') {
            router.push('/(surveyor-tabs)/profile');
            return;
        }

        // Navigate based on notification type for other types
        if (notification.reference_type === 'survey' && notification.reference_id) {
            router.push(`/survey-detail/${notification.reference_id}`);
        }
    };

    const handleAccept = async () => {
        if (!etaText || isNaN(etaText)) {
            Alert.alert('Invalid Time', 'Please enter a valid number');
            return;
        }

        setAccepting(true);
        try {
            const surveyId = selectedNotification?.reference_id;
            if (!surveyId) {
                Alert.alert('Error', 'Survey ID not found');
                return;
            }

            const res = await api.post(`/surveyor/surveys/${surveyId}/accept-broadcast`, {
                time_to_start_minutes: parseInt(etaText)
            });

            setAcceptModalVisible(false);

            if (res.success) {
                if (res.data?.assigned) {
                    Alert.alert('Success', 'Survey assigned to you!', [
                        { text: 'View Survey', onPress: () => router.push(`/survey-detail/${surveyId}`) }
                    ]);
                } else {
                    Alert.alert('Accepted', res.message || 'Response recorded. Waiting for selection results.');
                }
                onRefresh();
            }
        } catch (error) {
            Alert.alert('Error', error.message || 'Failed to accept survey');
        } finally {
            setAccepting(false);
            setSelectedNotification(null);
        }
    };

    const handleDecline = () => {
        Alert.alert('Decline Request', 'Are you sure you want to decline this survey?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Decline', style: 'destructive',
                onPress: async () => {
                    try {
                        const surveyId = selectedNotification?.reference_id;
                        if (surveyId) {
                            await api.post(`/surveyor/surveys/${surveyId}/decline-broadcast`);
                        }
                        setAcceptModalVisible(false);
                        setSelectedNotification(null);
                        onRefresh();
                    } catch (error) {
                        Alert.alert('Error', error.message);
                    }
                }
            }
        ]);
    };

    const handleMarkAllRead = async () => {
        const success = await markAllNotificationsAsRead();
        if (success) {
            setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
            setUnreadCount(0);
        }
    };

    const renderNotification = ({ item }) => {
        const iconName = getNotificationIcon(item.notification_type);
        const iconColor = getNotificationColor(item.notification_type);

        return (
            <TouchableOpacity
                style={[
                    styles.notificationItem,
                    !item.is_read && styles.unreadItem,
                ]}
                onPress={() => handleNotificationPress(item)}
                activeOpacity={0.7}
            >
                <View style={[styles.iconContainer, { backgroundColor: `${iconColor}15` }]}>
                    <MaterialIcons name={iconName} size={24} color={iconColor} />
                </View>
                <View style={styles.contentContainer}>
                    <View style={styles.headerRow}>
                        <Text style={[styles.title, !item.is_read && styles.unreadTitle]} numberOfLines={1}>
                            {item.title}
                        </Text>
                        {!item.is_read && <View style={styles.unreadDot} />}
                    </View>
                    <Text style={styles.body} numberOfLines={2}>
                        {item.body}
                    </Text>
                    <Text style={styles.timestamp}>
                        {formatTimeAgo(item.created_at)}
                    </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color="#CCC" />
            </TouchableOpacity>
        );
    };

    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <MaterialIcons name="notifications-none" size={64} color="#DDD" />
            <Text style={styles.emptyTitle}>No Notifications</Text>
            <Text style={styles.emptySubtitle}>
                You're all caught up! New notifications will appear here.
            </Text>
        </View>
    );

    if (loading) {
        return (
            <View style={[styles.container, styles.centered]}>
                <ActivityIndicator size="large" color={AppColors.primary} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <LinearGradient
                colors={[AppColors.gradientEnd, AppColors.primary]}
                style={[styles.headerGradient, { paddingTop: insets.top + 10 }]}
            >
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.back()}
                    >
                        <MaterialIcons name="arrow-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Notifications</Text>
                    {unreadCount > 0 && (
                        <TouchableOpacity
                            style={styles.markAllButton}
                            onPress={handleMarkAllRead}
                        >
                            <Text style={styles.markAllText}>Mark All Read</Text>
                        </TouchableOpacity>
                    )}
                </View>
                {unreadCount > 0 && (
                    <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>
                            {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
                        </Text>
                    </View>
                )}
            </LinearGradient>

            {/* Notifications List */}
            <FlatList
                data={notifications}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderNotification}
                contentContainerStyle={notifications.length === 0 ? styles.emptyContainer : styles.listContent}
                ListEmptyComponent={renderEmptyState}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={AppColors.primary}
                        colors={[AppColors.primary]}
                    />
                }
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                showsVerticalScrollIndicator={false}
            />

            {/* Accept/Decline Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={acceptModalVisible}
                onRequestClose={() => setAcceptModalVisible(false)}
            >
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                    <View style={styles.modalOverlay}>
                        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContent}>
                            <View style={styles.modalHeader}>
                                <MaterialIcons name="assignment" size={40} color={AppColors.primary} />
                                <Text style={styles.modalTitle}>New Survey Request</Text>
                            </View>

                            {selectedNotification && (
                                <View style={styles.surveyDetails}>
                                    <Text style={styles.surveyTitle}>{selectedNotification.title}</Text>
                                    <Text style={styles.surveyBody}>{selectedNotification.body}</Text>
                                </View>
                            )}

                            <Text style={styles.modalSubtitle}>How many minutes until you can start?</Text>

                            <View style={styles.optionsContainer}>
                                <FlatList
                                    data={TIME_OPTIONS}
                                    keyExtractor={(item) => item.value}
                                    style={styles.optionsList}
                                    renderItem={({ item }) => (
                                        <TouchableOpacity
                                            style={[
                                                styles.optionItem,
                                                etaText === item.value && styles.optionItemSelected
                                            ]}
                                            onPress={() => setEtaText(item.value)}
                                        >
                                            <Text style={[
                                                styles.optionText,
                                                etaText === item.value && styles.optionTextSelected
                                            ]}>
                                                {item.label}
                                            </Text>
                                            {etaText === item.value && (
                                                <MaterialIcons name="check" size={20} color={AppColors.primary} />
                                            )}
                                        </TouchableOpacity>
                                    )}
                                />
                            </View>

                            <View style={styles.modalActions}>
                                <TouchableOpacity style={[styles.modalBtn, styles.modalDeclineBtn]} onPress={handleDecline}>
                                    <Text style={styles.modalDeclineText}>Decline</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.modalBtn, styles.modalAcceptBtn, accepting && styles.modalBtnDisabled]}
                                    onPress={handleAccept}
                                    disabled={accepting}
                                >
                                    {accepting ? (
                                        <ActivityIndicator color="#FFF" size="small" />
                                    ) : (
                                        <Text style={styles.modalAcceptText}>Accept</Text>
                                    )}
                                </TouchableOpacity>
                            </View>

                            <TouchableOpacity style={styles.modalCancelLink} onPress={() => setAcceptModalVisible(false)}>
                                <Text style={styles.modalCancelText}>Decide Later</Text>
                            </TouchableOpacity>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8F9FA',
    },
    centered: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerGradient: {
        paddingHorizontal: 16,
        paddingBottom: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#FFF',
        flex: 1,
        textAlign: 'center',
    },
    markAllButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 16,
    },
    markAllText: {
        color: '#FFF',
        fontSize: 12,
        fontWeight: '600',
    },
    unreadBadge: {
        marginTop: 12,
        alignSelf: 'center',
        backgroundColor: 'rgba(255,255,255,0.25)',
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 20,
    },
    unreadBadgeText: {
        color: '#FFF',
        fontSize: 13,
        fontWeight: '500',
    },
    listContent: {
        paddingTop: 12,
        paddingBottom: 100,
    },
    emptyContainer: {
        flex: 1,
    },
    notificationItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
    },
    unreadItem: {
        backgroundColor: '#F0F7FF',
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    contentContainer: {
        flex: 1,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    title: {
        fontSize: 15,
        fontWeight: '500',
        color: '#333',
        flex: 1,
    },
    unreadTitle: {
        fontWeight: '700',
        color: '#111',
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: AppColors.primary,
    },
    body: {
        fontSize: 13,
        color: '#666',
        marginTop: 4,
        lineHeight: 18,
    },
    timestamp: {
        fontSize: 11,
        color: '#999',
        marginTop: 6,
    },
    separator: {
        height: 1,
        backgroundColor: '#F0F0F0',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
        paddingTop: 100,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginTop: 16,
    },
    emptySubtitle: {
        fontSize: 14,
        color: '#999',
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 20,
    },
    // Modal styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        padding: 24,
        width: '100%',
        maxWidth: 360,
    },
    modalHeader: {
        alignItems: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#333',
        marginTop: 12,
    },
    surveyDetails: {
        backgroundColor: '#F5F5F5',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
    },
    surveyTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#333',
        marginBottom: 6,
    },
    surveyBody: {
        fontSize: 13,
        color: '#666',
        lineHeight: 18,
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginBottom: 16,
    },
    // Added styles for options
    optionsContainer: {
        maxHeight: 250,
        marginBottom: 20,
        width: '100%',
    },
    optionsList: {
        width: '100%',
    },
    optionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginBottom: 8,
        backgroundColor: '#F5F5F7',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    optionItemSelected: {
        backgroundColor: '#F0F7FF',
        borderColor: AppColors.primary,
    },
    optionText: {
        fontSize: 16,
        color: '#333',
        fontWeight: '500',
    },
    optionTextSelected: {
        color: AppColors.primary,
        fontWeight: 'bold',
    },
    modalInput: {
        backgroundColor: '#F5F5F5',
        borderRadius: 12,
        padding: 16,
        fontSize: 18,
        textAlign: 'center',
        fontWeight: '600',
        marginBottom: 20,
    },
    modalActions: {
        flexDirection: 'row',
        gap: 12,
    },
    modalBtn: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    modalDeclineBtn: {
        backgroundColor: '#FEE2E2',
    },
    modalDeclineText: {
        color: '#EF4444',
        fontSize: 16,
        fontWeight: '600',
    },
    modalAcceptBtn: {
        backgroundColor: AppColors.primary,
    },
    modalAcceptText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
    modalBtnDisabled: {
        opacity: 0.7,
    },
    modalCancelLink: {
        alignItems: 'center',
        marginTop: 16,
    },
    modalCancelText: {
        color: '#999',
        fontSize: 14,
    },
});
