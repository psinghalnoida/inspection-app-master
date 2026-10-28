import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { useAuth } from '../../app/_layout';
import { useTabBarClearance } from '../../components/CustomTabBar';
import { AppColors } from '../../constants/theme';
import api from '../../lib/api';
import socketService from '../../lib/socket';
import surveyorService from '../../lib/surveyorService';
import { getMediaUrl } from '../../constants/config';
import {
  registerForPushNotifications,
  registerTokenWithBackend,
  getUnreadNotificationCount,
  addNotificationListener
} from '../../lib/notifications';
import { startSurveyAlertLoop, stopSurveyAlertSound } from '../../lib/sound';

const getProgressConfig = (status) => {
  const defaultGradient = ['#FFF0D9', '#D9CEF9'];

  const configs = {
    'assigned': {
      title: 'Survey Assigned',
      desc: 'Ready to start transit',
      icon: 'assignment-ind',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'in_transit': {
      title: 'In Transit',
      desc: 'On the way to location',
      icon: 'directions-car',
      color: '#FF8E53',
      gradientColors: defaultGradient,
    },
    'arrived': {
      title: 'Arrived at Location',
      desc: 'Ready for inspection',
      icon: 'place',
      color: '#2ECC71',
      gradientColors: defaultGradient,
    },
    'visit_completed': {
      title: 'Visit Completed',
      desc: 'Photos uploaded, submit report',
      icon: 'check-circle',
      color: '#4ECDC4',
      gradientColors: defaultGradient,
    },
    'report_submitted': {
      title: 'Report Submitted',
      desc: 'Waiting for approval',
      icon: 'description',
      color: '#9B8AFB',
      gradientColors: defaultGradient,
    },
  };
  return configs[status] || {
    title: 'Survey Status',
    desc: 'Processing survey',
    icon: 'info',
    color: '#7C3AED',
    gradientColors: defaultGradient,
  };
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

export default function SurveyorHomeScreen() {
  const router = useRouter();
  const { isAuthenticated, userRole, signOut } = useAuth();
  const tabBarClearance = useTabBarClearance();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [activeSurveys, setActiveSurveys] = useState([]);
  const [stats, setStats] = useState({
    assigned: 0,
    pending: 0,
    inProgress: 0,
    submitted: 0
  });

  const [etaModalVisible, setEtaModalVisible] = useState(false);
  const [selectedNotifId, setSelectedNotifId] = useState(null);
  const [etaText, setEtaText] = useState('0');
  const [unreadCount, setUnreadCount] = useState(0);
  const [openPoolNotice, setOpenPoolNotice] = useState('');

  const fetchData = async () => {
    if (!isAuthenticated || userRole !== 'surveyor') return;
    try {
      const profileRes = await api.get('/surveyor/profile');
      if (profileRes.success) {
        setProfile(profileRes.data);
      }

      const notifRes = await api.get('/surveyor/notifications?status=pending');
      if (notifRes.success) {
        setNotifications(notifRes.data || []);
      }

      const surveysRes = await api.get('/surveyor/surveys?limit=100');
      if (surveysRes.success) {
        const allSurveys = surveysRes.data || [];

        const assigned = allSurveys.filter(s => s.status === 'assigned').length;
        const inProgress = allSurveys.filter(s => ['in_transit', 'arrived', 'visit_completed'].includes(s.status)).length;
        const submitted = allSurveys.filter(s => ['report_submitted', 'finished', 'completed'].includes(s.status)).length;

        setStats({
          assigned,
          pending: notifRes.data?.length || 0,
          inProgress,
          submitted
        });

        const active = allSurveys.filter(s => ['assigned', 'in_transit', 'arrived', 'visit_completed', 'report_submitted'].includes(s.status));
        setActiveSurveys(active);
      }

      // v2 §2.3: a company surveyor is out of the open pool and the server says
      // so in words. Its own try — this endpoint 400s when the surveyor has no
      // location yet, which must not abort the rest of the refresh.
      try {
        const openPool = await surveyorService.getAvailableBroadcasts();
        setOpenPoolNotice(openPool.surveys.length === 0 ? openPool.message : '');
      } catch (broadcastError) {
        setOpenPoolNotice('');
      }
    } catch (error) {
      console.error('Home data fetch error:', error);
      if (error.message?.includes('Session expired') ||
        error.message?.includes('Token expired') ||
        error.message?.includes('Invalid token') ||
        error.message?.includes('No token') ||
        error.message?.includes('Unauthorized') ||
        error.status === 401) {
        signOut();
        return;
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated && userRole === 'surveyor') {
        fetchData();
        fetchUnreadCount();
      }
    }, [isAuthenticated, userRole])
  );

  // Setup push notifications
  useEffect(() => {
    if (isAuthenticated && userRole === 'surveyor') {
      setupPushNotifications();

      // Add notification listener for push notifications
      const cleanup = addNotificationListener(
        (notification) => {
          // On notification received, refresh unread count
          fetchUnreadCount();
        },
        (response) => {
          // On notification tap, navigate to notifications
          router.push('/notifications');
        }
      );

      return cleanup;
    }
  }, [isAuthenticated, userRole]);

  const setupPushNotifications = async () => {
    try {
      const token = await registerForPushNotifications();
      if (token) {
        await registerTokenWithBackend(token);
      }
    } catch (error) {
      console.error('Push notification setup error:', error);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const count = await getUnreadNotificationCount();
      setUnreadCount(count);
    } catch (error) {
      console.error('Error fetching unread count:', error);
    }
  };

  // Socket.IO connection for real-time notifications
  useEffect(() => {
    if (!isAuthenticated || userRole !== 'surveyor') return;

    let unsubscribeNotification = null;
    let unsubscribeExpired = null;
    let unsubscribeUnread = null;
    let unsubscribeGeneric = null;

    const connectSocket = async () => {
      try {
        await socketService.connect();
        console.log('🔌 Socket connected for real-time notifications');

        // Listen for new survey requests
        unsubscribeNotification = socketService.onNewRequest((newNotification) => {
          console.log('📲 New notification received:', newNotification);

          // Ring continuously until the surveyor accepts/declines or the broadcast expires.
          // The OS push notification (sent by the backend on the 'survey_requests' channel)
          // surfaces the request when the app is backgrounded; this in-app loop takes over
          // once the surveyor opens the app.
          startSurveyAlertLoop();

          // Add to notifications list if not already present
          setNotifications(prev => {
            const exists = prev.some(n => n.survey_id === newNotification.survey_id);
            if (exists) return prev;

            // Update pending stats
            setStats(prevStats => ({
              ...prevStats,
              pending: prevStats.pending + 1
            }));

            return [newNotification, ...prev];
          });
        });

        // Listen for expired broadcast notifications
        unsubscribeExpired = socketService.onNotificationExpired((expiredData) => {
          console.log('⏰ Notification expired from server:', expiredData);

          // Remove the expired notification from the list
          setNotifications(prev => {
            const filtered = prev.filter(n => n.survey_id !== expiredData.survey_id);
            if (filtered.length < prev.length) {
              // Update pending stats
              setStats(prevStats => ({
                ...prevStats,
                pending: Math.max(0, prevStats.pending - 1)
              }));
            }
            // If nothing is pending anymore, silence the ringtone.
            if (filtered.length === 0) stopSurveyAlertSound();
            return filtered;
          });
        });

        // Listen for new generic notifications (Assigned, Payment, etc.)
        unsubscribeGeneric = socketService.onNewNotification((newNotif) => {
          console.log('🔔 Generic notification received:', newNotif);
          fetchUnreadCount();
          fetchData(); // Refresh all data to update Active Surveys list

          // Show specific alerts based on type
          if (newNotif.notification_type === 'survey_assigned') {
            Alert.alert(
              '🎉 Survey Assigned!',
              newNotif.body,
              [{ text: 'View Survey', onPress: () => router.push(`/survey-detail/${newNotif.reference_id}`) }]
            );
          } else if (newNotif.notification_type === 'payment_completed') {
            Alert.alert(
              '💰 Payment Received',
              newNotif.body,
              [{ text: 'Start Survey', onPress: () => router.push(`/survey-detail/${newNotif.reference_id}`) }]
            );
          } else if (newNotif.notification_type !== 'broadcast_request') {
            // broadcast_request is handled separately by onNewRequest
            // For other types like report_accepted, etc.
            Alert.alert(
              newNotif.title || 'New Notification',
              newNotif.body,
              [{ text: 'OK' }]
            );
          }
        });

        // Listen for unread count updates
        unsubscribeUnread = socketService.onUnreadCount((count) => {
          setUnreadCount(count);
        });

      } catch (error) {
        console.error('Socket connection error:', error);
      }
    };

    connectSocket();

    return () => {
      if (unsubscribeNotification) unsubscribeNotification();
      if (unsubscribeExpired) unsubscribeExpired();
      if (unsubscribeUnread) unsubscribeUnread();
      if (unsubscribeGeneric) unsubscribeGeneric();
    };
  }, [isAuthenticated]);

  // Auto-remove expired notifications based on broadcast_ends_at
  useEffect(() => {
    const timers = [];

    notifications.forEach(notification => {
      if (notification.broadcast_ends_at) {
        const expiryTime = new Date(notification.broadcast_ends_at).getTime();
        const now = Date.now();
        const timeUntilExpiry = expiryTime - now;

        if (timeUntilExpiry <= 0) {
          // Already expired, remove immediately
          setNotifications(prev => {
            const filtered = prev.filter(n => n.id !== notification.id && n.survey_id !== notification.survey_id);
            if (filtered.length === 0) stopSurveyAlertSound();
            return filtered;
          });
          setStats(prevStats => ({
            ...prevStats,
            pending: Math.max(0, prevStats.pending - 1)
          }));
        } else {
          // Set timer to remove when expired
          const timer = setTimeout(() => {
            console.log(`⏰ Notification expired: ${notification.id || notification.survey_id}`);
            setNotifications(prev => {
              const filtered = prev.filter(n => n.id !== notification.id && n.survey_id !== notification.survey_id);
              if (filtered.length === 0) stopSurveyAlertSound();
              return filtered;
            });
            setStats(prevStats => ({
              ...prevStats,
              pending: Math.max(0, prevStats.pending - 1)
            }));
          }, timeUntilExpiry);

          timers.push(timer);
        }
      }
    });

    // Cleanup timers on unmount or when notifications change
    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [notifications]);

  // Ring while there's at least one pending broadcast on screen, silence otherwise.
  // This also covers the case where the surveyor opens the app via push tap and the
  // pending broadcast list is hydrated from the API on first load.
  useEffect(() => {
    const hasPending = notifications.some(n => !n.broadcast_ends_at || new Date(n.broadcast_ends_at).getTime() > Date.now());
    if (hasPending) {
      startSurveyAlertLoop();
    } else {
      stopSurveyAlertSound();
    }
  }, [notifications]);

  // Always silence the ringtone when leaving the screen.
  useEffect(() => {
    return () => {
      stopSurveyAlertSound();
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
    fetchUnreadCount();
  }, []);

  const toggleAvailability = async (value) => {
    try {
      setProfile(prev => ({ ...prev, is_available: value }));

      if (value === true) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();

          if (status !== 'granted') {
            Alert.alert(
              'Location Required',
              'Location permission is required to go online.',
              [{ text: 'OK' }]
            );
            setProfile(prev => ({ ...prev, is_available: false }));
            return;
          }

          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });

          const { latitude, longitude } = location.coords;
          await api.put('/surveyor/location', { latitude, longitude });

        } catch (locError) {
          console.error('Location error:', locError);
          Alert.alert(
            'Location Error',
            'Could not get your location. Please ensure GPS is enabled.',
            [{ text: 'OK' }]
          );
          setProfile(prev => ({ ...prev, is_available: false }));
          return;
        }
      }

      const res = await api.put('/surveyor/availability', { is_available: value });
      if (!res.success) {
        setProfile(prev => ({ ...prev, is_available: !value }));
        Alert.alert('Error', 'Failed to update availability');
      }
    } catch (error) {
      setProfile(prev => ({ ...prev, is_available: !value }));
      Alert.alert('Error', error.message);
    }
  };

  const handleAcceptNotification = (id) => {
    // Surveyor is engaging with the request — silence the ringtone immediately.
    stopSurveyAlertSound();
    setSelectedNotifId(id);
    setEtaText('0');
    setEtaModalVisible(true);
  };

  const confirmAccept = async () => {
    if (!etaText || isNaN(etaText)) {
      Alert.alert('Invalid Time', 'Please enter a valid number');
      return;
    }

    setEtaModalVisible(false);
    setLoading(true);

    try {
      // Check if it's a broadcast notification (logic assumes newer notifications are broadcasts)
      // We need the survey_id. Assuming selectedNotifId is the notification ID.
      // Ideally we should have the notification object.
      // Let's try to find it from the state.
      const notif = notifications.find(n => n.id === selectedNotifId);

      let res;
      if (notif && notif.survey_id) {
        // Use the new broadcast acceptance endpoint
        res = await api.post(`/surveyor/surveys/${notif.survey_id}/accept-broadcast`, { time_to_start_minutes: parseInt(etaText) });
      } else {
        // Fallback to old flow
        res = await api.post(`/surveyor/notifications/${selectedNotifId}/accept`, { eta_minutes: parseInt(etaText) });
      }

      if (res.success) {
        if (res.data?.assigned) {
          Alert.alert('Success', 'Survey assigned to you!');
        } else {
          Alert.alert('Accepted', res.message || 'Response recorded. Waiting for selection results.');
        }
        fetchData();
      }
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
      setSelectedNotifId(null);
    }
  };

  const handleDeclineNotification = (id) => {
    // Pause the ringtone while the confirmation dialog is up; we'll resume it
    // if the surveyor cancels and there are still pending broadcasts.
    stopSurveyAlertSound();
    Alert.alert('Decline Request', 'Are you sure you want to decline?', [
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: () => {
          // User cancelled — if there are still pending broadcasts, resume ringing.
          setNotifications((prev) => {
            if (prev.length > 0) startSurveyAlertLoop();
            return prev;
          });
        },
      },
      {
        text: 'Decline', style: 'destructive',
        onPress: async () => {
          try {
            await api.post(`/surveyor/notifications/${id}/decline`, { decline_reason: 'Busy' });
            fetchData();
          } catch (error) {
            Alert.alert('Error', error.message);
          }
        }
      }
    ])
  };

  const navigateToSurvey = (id) => {
    router.push(`/survey-detail/${id}`);
  };

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={AppColors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[AppColors.gradientEnd, AppColors.primary]}
        style={styles.headerGradient}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.userInfo}>
            <Image
              source={{ uri: getMediaUrl(profile?.profile_picture_url) || 'https://ui-avatars.com/api/?name=' + (profile?.full_name || 'User') }}
              style={styles.avatar}
              contentFit="cover"
            />
            <View style={styles.headerTextContainer}>
              <Text style={styles.companyName} numberOfLines={1}>
                ClaimsMitra Surveyor
              </Text>
              <Text style={styles.welcomeText}>
                Welcome, {profile?.full_name || 'Surveyor'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.notificationBtn}
            onPress={() => router.push('/notifications')}
          >
            <MaterialIcons name="notifications-none" size={24} color="#FFF" />
            {unreadCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Availability Toggle */}
        <View style={styles.availabilityRow}>
          <View style={styles.availabilityLeft}>
            <MaterialIcons name={profile?.is_available ? "wifi-tethering" : "wifi-off"} size={20} color="#FFF" />
            <Text style={styles.availabilityText}>
              {profile?.is_available ? 'You are available' : 'You are not available'}
            </Text>
          </View>
          <Switch
            value={!!profile?.is_available}
            onValueChange={toggleAvailability}
            trackColor={{ false: 'rgba(255,255,255,0.3)', true: '#4ECDC4' }}
            thumbColor="#FFF"
          />
        </View>
      </LinearGradient>

      {/* White Background with Rounded Top */}
      <View style={styles.whiteBackground}>
        {/* Stats Row - Positioned to overlap both header and white area */}
        <View style={styles.statsRowContainer}>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialIcons name="person-add" size={22} color="rgba(255,255,255,0.8)" />
              </View>
              <Text style={styles.statValue}>{stats.assigned}</Text>
              <Text style={styles.statLabel}>Assigned</Text>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialIcons name="schedule" size={22} color="rgba(255,255,255,0.8)" />
              </View>
              <Text style={styles.statValue}>{stats.pending}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialIcons name="send" size={22} color="rgba(255,255,255,0.8)" />
              </View>
              <Text style={styles.statValue}>{stats.inProgress}</Text>
              <Text style={styles.statLabel}>In Progress</Text>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialIcons name="check-circle-outline" size={22} color="rgba(255,255,255,0.8)" />
              </View>
              <Text style={styles.statValue}>{stats.submitted}</Text>
              <Text style={styles.statLabel}>Submitted</Text>
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={AppColors.primary} />}
        >
          {/* Active Surveys Progress Cards - Horizontal Scroll */}
          {activeSurveys.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.progressScrollContent}
              style={styles.progressScroll}
            >
              {activeSurveys.slice(0, 8).map((survey) => {
                const statusConfig = getProgressConfig(survey.status);
                return (
                  <TouchableOpacity
                    key={survey.id}
                    activeOpacity={0.9}
                    onPress={() => navigateToSurvey(survey.id)}
                  >
                    <LinearGradient
                      colors={statusConfig.gradientColors || ['#FFF5E6', '#E8E0F0']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.progressCard}
                    >
                      <View style={[styles.progressIconCircle, { borderColor: statusConfig.color }]}>
                        <MaterialIcons name={statusConfig.icon} size={24} color={statusConfig.color} />
                      </View>
                      <View style={styles.progressContent}>
                        <Text style={styles.progressTitle} numberOfLines={1}>{statusConfig.title}</Text>
                        <Text style={styles.progressDesc} numberOfLines={1}>{survey.case_reference || `Survey #${survey.id}`}</Text>
                        <TouchableOpacity
                          style={styles.progressActionBtn}
                          onPress={() => navigateToSurvey(survey.id)}
                        >
                          <Text style={styles.progressActionText}>View Details</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.progressRightIcon}>
                        <MaterialIcons name="receipt-long" size={24} color="rgba(128,128,200,0.4)" />
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Why there are no open requests (server-written explanation) */}
          {openPoolNotice ? (
            <View style={styles.openPoolNotice}>
              <MaterialIcons name="info-outline" size={20} color="#8D6E00" />
              <Text style={styles.openPoolNoticeText}>{openPoolNotice}</Text>
            </View>
          ) : null}

          {/* New Requests Section */}
          {notifications.length > 0 && (
            <View>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>New Requests</Text>
                <View style={styles.requestBadge}>
                  <Text style={styles.requestBadgeText}>{notifications.length}</Text>
                </View>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.requestCardsContainer} contentContainerStyle={styles.requestCardsContent}>
                {notifications.map((notif) => (
                  <View key={notif.id} style={styles.requestCard}>
                    <View style={styles.requestCardTop}>
                      <View style={styles.requestIcon}>
                        <MaterialIcons name="inventory-2" size={24} color={AppColors.primary} />
                      </View>
                      <View style={styles.requestInfo}>
                        <Text style={styles.requestTitle} numberOfLines={1}>{(notif.survey_type || 'New Survey').replace(/_/g, ' ').toUpperCase()}</Text>
                        <Text style={styles.requestSubtitle} numberOfLines={1}>
                          {notif.city || 'Unknown City'}, {notif.state || ''}
                        </Text>
                        <Text style={styles.requestRef}>{notif.case_reference || 'No Ref'}</Text>
                      </View>
                    </View>
                    <View style={styles.distanceBadge}>
                      <MaterialIcons name="near-me" size={14} color={AppColors.primary} />
                      <Text style={styles.distanceText}>
                        {notif.distance_from_incident_km !== null && notif.distance_from_incident_km !== undefined
                          ? `${parseFloat(notif.distance_from_incident_km).toFixed(1)} km away`
                          : 'Distance N/A'}
                      </Text>
                    </View>
                    <View style={styles.requestActions}>
                      <TouchableOpacity style={[styles.requestActionBtn, styles.declineBtn]} onPress={() => handleDeclineNotification(notif.id)}>
                        <Text style={[styles.requestActionText, { color: 'red' }]}>Decline</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.requestActionBtn, styles.acceptBtn]} onPress={() => handleAcceptNotification(notif.id)}>
                        <Text style={styles.requestActionText}>Accept</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Active Surveys List */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Active Surveys</Text>
            <TouchableOpacity onPress={() => router.push('/(surveyor-tabs)/surveys')}>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>

          {activeSurveys.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="assignment" size={64} color="#DDD" />
              <Text style={styles.emptyText}>No active surveys</Text>
              <Text style={styles.emptySubtext}>
                {openPoolNotice
                  ? 'Your company assigns surveys to you directly'
                  : 'Turn on availability to receive requests'}
              </Text>
            </View>
          ) : (
            <View style={styles.surveysList}>
              {activeSurveys.map((survey) => (
                <TouchableOpacity key={survey.id} onPress={() => navigateToSurvey(survey.id)}>
                  <LinearGradient
                    colors={['#7B68EE', '#9B8AFB']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.surveyItemGradient}
                  >
                    <View style={styles.surveyItemIcon}>
                      <MaterialIcons
                        name={survey.survey_type?.includes('motor') ? 'directions-car' : survey.survey_type?.includes('marine') ? 'directions-boat' : 'search'}
                        size={24}
                        color="#FFF"
                      />
                    </View>
                    <View style={styles.surveyItemInfo}>
                      <Text style={styles.surveyItemTitle} numberOfLines={1}>
                        {survey.case_reference || `Survey #${survey.id}`}
                      </Text>
                      <Text style={styles.surveyItemSubtitle}>
                        {survey.survey_type?.replace(/_/g, ' ').toUpperCase()}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(survey.status) }]}>
                      <Text style={styles.statusText}>{survey.status.replace(/_/g, ' ')}</Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ height: tabBarClearance }} />
        </ScrollView>
      </View>

      {/* ETA Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={etaModalVisible}
        onRequestClose={() => {
          setEtaModalVisible(false);
          // Cancelled — if there are still pending broadcasts, resume ringing.
          if (notifications.length > 0) startSurveyAlertLoop();
        }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContent}>
              <Text style={styles.modalTitle}>Time to Start</Text>
              <Text style={styles.modalSubtitle}>How many minutes until you start your journey?</Text>

              <View style={styles.optionsContainer}>
                <ScrollView style={styles.optionsScroll} showsVerticalScrollIndicator={false}>
                  {TIME_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.optionItem,
                        etaText === option.value && styles.optionItemSelected
                      ]}
                      onPress={() => setEtaText(option.value)}
                    >
                      <Text style={[
                        styles.optionText,
                        etaText === option.value && styles.optionTextSelected
                      ]}>
                        {option.label}
                      </Text>
                      {etaText === option.value && (
                        <MaterialIcons name="check" size={20} color={AppColors.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.modalBtn, styles.modalCancelBtn]} onPress={() => {
                  setEtaModalVisible(false);
                  if (notifications.length > 0) startSurveyAlertLoop();
                }}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, styles.modalConfirmBtn]} onPress={confirmAccept}>
                  <Text style={styles.modalConfirmText}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

// Helpers
const getStatusColor = (status) => {
  switch (status) {
    case 'assigned': return '#9B8AFB';
    case 'in_transit': return '#FF8E53';
    case 'arrived': return '#2ECC71';
    case 'visit_completed': return '#4ECDC4';
    default: return '#666';
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  whiteBackground: {
    flex: 1,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    marginTop: -30,
  },
  // Added styles for options
  optionsContainer: {
    maxHeight: 250,
    marginBottom: 20,
    width: '100%',
  },
  optionsScroll: {
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
  headerGradient: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 80,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#FFF',
    backgroundColor: '#DDD',
  },
  headerTextContainer: {
    flex: 1,
  },
  companyName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 2,
  },
  welcomeText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  notificationBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  notificationBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  availabilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 2,
    marginBottom: 16,
  },
  availabilityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  availabilityText: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '500',
  },
  statsRowContainer: {
    marginTop: -50,
    marginBottom: 20,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  statCard: {
    flex: 1,
    flexBasis: 0,
    backgroundColor: '#a28aeaff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    aspectRatio: 1,
    position: 'relative',
  },
  statIconContainer: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 20,
  },
  statLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
    fontWeight: '500',
  },
  content: {
    flex: 1,
  },
  progressScroll: {
    paddingBottom: 10,
  },
  progressScrollContent: {
    paddingHorizontal: 20,
    gap: 16,
  },
  progressCard: {
    width: 280,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  progressIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContent: {
    flex: 1,
  },
  progressTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  progressDesc: {
    fontSize: 12,
    color: '#666',
    marginBottom: 10,
  },
  progressRightIcon: {
    opacity: 0.4,
  },
  progressActionBtn: {
    backgroundColor: '#4A90D9',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  progressActionText: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  viewAllText: {
    fontSize: 14,
    color: AppColors.primary,
    fontWeight: '500',
  },
  requestBadge: {
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  requestBadgeText: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: 'bold',
  },
  openPoolNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#FFE082',
    borderRadius: 12,
    padding: 12,
  },
  openPoolNoticeText: {
    flex: 1,
    fontSize: 13,
    color: '#8D6E00',
    lineHeight: 18,
  },
  requestCardsContainer: { marginTop: 4, minHeight: 180 },
  requestCardsContent: { paddingHorizontal: 16, gap: 12, paddingBottom: 10 },
  requestCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    width: 280,
    marginRight: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  requestCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  requestIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0EEFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  requestInfo: { flex: 1 },
  requestTitle: { fontSize: 13, fontWeight: '600', color: '#333' },
  requestSubtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  requestRef: { fontSize: 11, color: '#999', marginTop: 2 },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0EEFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 12,
    alignSelf: 'flex-start',
    gap: 4,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '600',
    color: AppColors.primary,
  },
  requestActions: { flexDirection: 'row', gap: 8 },
  requestActionBtn: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: { backgroundColor: AppColors.primary },
  declineBtn: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#EEE' },
  requestActionText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  surveysList: {
    paddingHorizontal: 20,
    gap: 12,
  },
  surveyItemGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderRadius: 16,
  },
  surveyItemIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  surveyItemInfo: {
    flex: 1,
  },
  surveyItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  surveyItemSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 10,
    color: '#FFF',
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#999',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#BBB',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20
  },
  modalContent: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20, width: '100%', maxWidth: 340, alignItems: 'center', elevation: 5
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#333' },
  modalSubtitle: { fontSize: 14, color: '#666', marginBottom: 16, textAlign: 'center' },
  modalInput: {
    width: '100%', borderWidth: 1, borderColor: '#DDD', borderRadius: 8, padding: 12, fontSize: 16, textAlign: 'center', marginBottom: 20, backgroundColor: '#F8F8F8'
  },
  modalActions: { flexDirection: 'row', gap: 12, width: '100%' },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  modalCancelBtn: { backgroundColor: '#F0F0F0' },
  modalConfirmBtn: { backgroundColor: AppColors.primary },
  modalCancelText: { color: '#666', fontWeight: '600' },
  modalConfirmText: { color: '#FFF', fontWeight: '600' }
});
