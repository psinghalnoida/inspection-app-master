import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../app/_layout';
import { useTabBarClearance } from '../components/CustomTabBar';
import { AppColors } from '../constants/theme';
import { getMediaUrl } from '../constants/config';
import api from '../lib/api';
import socketService from '../lib/socket';
import {
  registerForPushNotifications,
  registerTokenWithBackend,
  getUnreadNotificationCount,
  addNotificationListener
} from '../lib/notifications';

const SURVEY_TYPES = [
  {
    icon: 'directions-car',
    label: 'Motor Spot\nSurvey',
    gradientColors: ['#9B59B6', '#8E44AD'], // Purple gradient
    route: '/motor-spot-survey'
  },
  {
    icon: 'ac-unit',
    label: 'Motor Final\nSurvey',
    gradientColors: ['#1ABC9C', '#16A085'], // Teal gradient
    route: '/motor-final-survey'
  },
  {
    icon: 'directions-boat',
    label: 'Marine Spot\nSurvey',
    gradientColors: ['#E74C3C', '#C0392B'], // Coral/Red gradient
    route: '/marine-spot-survey'
  },
  {
    icon: 'search',
    label: 'Inspection /\nInvestigation',
    gradientColors: ['#3498DB', '#2980B9'], // Blue gradient
    route: '/inspection-investigation'
  },
];

const getStatusColor = (status) => {
  switch (status) {
    case 'pending_assignment': return '#FF9500';
    case 'assigned': return '#5AC8FA';
    case 'in_progress': return '#007AFF';
    case 'reached': return '#34C759';
    case 'completed': return '#AF52DE';
    case 'cancelled': return '#FF3B30';
    default: return '#999';
  }
};

const formatStatus = (status) => {
  return status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
};

const getProgressConfig = (status) => {
  // All cards use the same beautiful gradient: #FFF0D9 (peach) to #D9CEF9 (lavender)
  const defaultGradient = ['#FFF0D9', '#D9CEF9'];

  const configs = {
    'pending_assignment': {
      title: 'Survey Request Submitted',
      desc: 'Waiting for surveyor acceptance',
      icon: 'schedule',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'pending_payment': {
      title: 'Payment Pending',
      desc: 'Awaiting payment confirmation',
      icon: 'payment',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'location_detected': {
      title: 'Location Detected',
      desc: 'Coordinates captured via SMS',
      icon: 'location-on',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'assigned': {
      title: 'Surveyor Accepted Request',
      desc: 'Idle. Beginners in assign surveys',
      icon: 'person-add',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'in_transit': {
      title: 'Survey In-transit',
      desc: 'Surveyor is on the way to location',
      icon: 'directions-car',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'reached': {
      title: 'Visit Completed',
      desc: 'Reaches X mins | Photos uploaded',
      icon: 'check-circle',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'photos_uploaded': {
      title: 'Photos Uploaded',
      desc: 'Photos captured and uploaded',
      icon: 'photo-camera',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'report_submitted': {
      title: 'Report Submitted',
      desc: 'Photos needs the report',
      icon: 'description',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'completed': {
      title: 'Survey Successfully Completed',
      desc: 'Payment released to surveyor',
      icon: 'verified',
      color: '#7C3AED',
      gradientColors: defaultGradient,
    },
    'cancelled': {
      title: 'Survey Cancelled',
      desc: 'This survey has been cancelled',
      icon: 'cancel',
      color: '#FF3B30',
      gradientColors: defaultGradient,
    }
  };
  return configs[status] || {
    title: formatStatus(status),
    desc: 'Current Status',
    icon: 'info',
    color: '#7C3AED',
    gradientColors: defaultGradient,
  };
};

export default function HomeScreen() {
  const router = useRouter();
  const { isAuthenticated, userRole, signOut } = useAuth();
  const tabBarClearance = useTabBarClearance();
  const [profile, setProfile] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [stats, setStats] = useState({ assigned: 0, pending: 0, inProgress: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated && userRole === 'assigner') {
        fetchData();
        fetchUnreadCount();
      }
    }, [isAuthenticated, userRole])
  );

  useEffect(() => {
    if (isAuthenticated && userRole === 'assigner') {
      setupPushNotifications();

      // Add notification listener
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

  // Socket.IO connection for real-time notifications
  useEffect(() => {
    if (!isAuthenticated || userRole !== 'assigner') return;

    let unsubscribeUnread = null;

    const connectSocket = async () => {
      try {
        await socketService.connect();

        // Listen for new generic notifications
        unsubscribeUnread = socketService.onNewNotification((newNotif) => {
          console.log('🔔 Generic notification received:', newNotif);
          fetchUnreadCount();
          fetchData(); // Refresh all data

          // Show specific alerts based on type
          if (newNotif.notification_type === 'survey_assigned') {
            Alert.alert(
              '✅ Surveyor Assigned',
              newNotif.body,
              [{ text: 'View Survey', onPress: () => router.push(`/survey-detail/${newNotif.reference_id}`) }]
            );
          } else {
            Alert.alert(
              newNotif.title || 'New Notification',
              newNotif.body,
              [{ text: 'OK' }]
            );
          }
        });

        // Listen for unread count updates
        socketService.onUnreadCount((count) => {
          setUnreadCount(count);
        });

      } catch (error) {
        console.error('Socket connection error:', error);
      }
    };

    connectSocket();

    return () => {
      if (unsubscribeUnread) unsubscribeUnread();
    };
  }, [isAuthenticated]);

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

  const fetchData = async () => {
    if (!isAuthenticated || userRole !== 'assigner') return;
    try {
      // Fetch profile
      const profileRes = await api.get('/assigner/profile');
      if (profileRes.success) {
        setProfile(profileRes.data);
      }

      // Fetch surveys
      const surveysRes = await api.get('/assigner/surveys', { limit: 100 });
      if (surveysRes.success) {
        const surveyList = surveysRes.data || [];
        setSurveys(surveyList.slice(0, 10)); // Recent 10 surveys

        // Calculate stats
        const newStats = {
          assigned: surveyList.filter(s => s.status === 'assigned').length,
          pending: surveyList.filter(s => s.status === 'pending_assignment' || s.status === 'pending_payment').length,
          inProgress: surveyList.filter(s => ['in_progress', 'reached', 'photos_uploaded'].includes(s.status)).length,
          completed: surveyList.filter(s => ['finished', 'completed'].includes(s.status)).length,
        };
        setStats(newStats);
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
    fetchUnreadCount();
  }, []);

  const handleSurveyTypePress = (type) => {
    if (type.route) {
      router.push(type.route);
    }
  };

  const handleSurveyPress = (survey) => {
    // Navigate to survey detail (to be implemented)
    console.log('Survey pressed:', survey.id);
  };

  if (loading) {
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
            {profile?.profile_picture_url ? (
              <Image
                source={{ uri: getMediaUrl(profile.profile_picture_url) }}
                style={styles.avatar}
              />
            ) : (
              <View style={[styles.avatar, styles.initialsAvatar]}>
                <Text style={styles.initialsText}>
                  {(profile?.company_name || profile?.contact_person_name || 'A')?.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.headerTextContainer}>
              <Text style={styles.companyName} numberOfLines={1}>
                ClaimsMitra Assigner
              </Text>
              <Text style={styles.welcomeText}>
                Welcome, {profile?.contact_person_name || profile?.company_name || 'Assigner'}
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
      </LinearGradient>

      {/* White Background with Rounded Top */}
      <View style={styles.whiteBackground}>
        {/* Stats Row - Positioned to overlap both header and white area */}
        <View style={styles.statsRowContainer}>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialIcons name="people-outline" size={24} color="rgba(255,255,255,0.8)" />
              </View>
              <Text style={styles.statValue}>{stats.assigned}</Text>
              <Text style={styles.statLabel}>Assigned</Text>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialIcons name="schedule" size={24} color="rgba(255,255,255,0.8)" />
              </View>
              <Text style={styles.statValue}>{stats.pending}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialIcons name="send" size={24} color="rgba(255,255,255,0.8)" />
              </View>
              <Text style={styles.statValue}>{stats.inProgress}</Text>
              <Text style={styles.statLabel}>In Progress</Text>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialIcons name="check-circle-outline" size={24} color="rgba(255,255,255,0.8)" />
              </View>
              <Text style={styles.statValue}>{stats.completed}</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={AppColors.primary} />
          }
        >
          {/* Survey Progress Cards - Horizontal Scroll */}
          {surveys.filter(s => !['completed', 'finished', 'cancelled'].includes(s.status)).length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.progressScrollContent}
              style={styles.progressScroll}
            >
              {surveys.filter(s => !['completed', 'finished', 'cancelled'].includes(s.status)).slice(0, 8).map((survey) => {
                const statusConfig = getProgressConfig(survey.status);
                return (
                  <TouchableOpacity
                    key={survey.id}
                    activeOpacity={0.9}
                    onPress={() => router.push(`/survey-detail/${survey.id}`)}
                  >
                    <LinearGradient
                      colors={statusConfig.gradientColors || ['#FFF5E6', '#E8E0F0']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.progressCard}
                    >
                      {/* Left Icon */}
                      <View style={[styles.progressIconCircle, { borderColor: statusConfig.color }]}>
                        <MaterialIcons name={statusConfig.icon} size={24} color={statusConfig.color} />
                      </View>

                      {/* Content */}
                      <View style={styles.progressContent}>
                        <Text style={styles.progressTitle} numberOfLines={1}>{statusConfig.title}</Text>
                        <Text style={styles.progressDesc} numberOfLines={1}>{statusConfig.desc}</Text>
                        <TouchableOpacity
                          style={styles.progressActionBtn}
                          onPress={() => router.push(`/survey-detail/${survey.id}`)}
                        >
                          <Text style={styles.progressActionText}>View Details</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Right Icon */}
                      <View style={styles.progressRightIcon}>
                        <MaterialIcons name="receipt-long" size={24} color="rgba(128,128,200,0.4)" />
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Survey Types Grid */}
          <View style={[styles.surveyGrid, { paddingHorizontal: 20, marginTop: surveys.length > 0 ? 5 : 40 }]}>
            {SURVEY_TYPES.map((type, index) => (
              <TouchableOpacity
                key={index}
                style={styles.surveyCardWrapper}
                onPress={() => handleSurveyTypePress(type)}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={type.gradientColors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.surveyCard}
                >
                  <MaterialIcons
                    name={type.icon}
                    size={28}
                    color="rgba(255,255,255,0.9)"
                  />
                  <Text style={styles.surveyLabel}>
                    {type.label}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>

          {/* Recent Surveys */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Activities</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/survey')}>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>

          {surveys.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="assignment" size={48} color="#CCC" />
              <Text style={styles.emptyText}>No surveys yet</Text>
              <Text style={styles.emptySubtext}>Create your first survey above</Text>
            </View>
          ) : (
            <View style={styles.surveysList}>
              {surveys.map((survey) => (
                <TouchableOpacity
                  key={survey.id}
                  style={styles.surveyItem}
                  onPress={() => handleSurveyPress(survey)}
                >
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
                        {survey.claim_number || `Survey #${survey.id}`}
                      </Text>
                      <Text style={styles.surveyItemSubtitle}>
                        {formatStatus(survey.survey_type)} • {new Date(survey.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(survey.status) }]}>
                      <Text style={styles.statusText}>{formatStatus(survey.status)}</Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ height: tabBarClearance }} />
        </ScrollView>
      </View>
    </View>
  );
}

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
  headerGradient: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 70, // Extra space for overlapping stats
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
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
  },
  initialsAvatar: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  initialsText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
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
  userName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
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
  statsRowContainer: {
    marginTop: -40, // Pull up to overlap with header
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
    aspectRatio: 1, // Square shape
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
  // Progress Cards (Horizontal Scroll)
  progressScroll: {
    paddingBottom: 20
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
    marginTop: 24,
    marginBottom: 16,
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
  surveyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  surveyCardWrapper: {
    width: '48%',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  surveyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 12,
    minHeight: 90,
  },
  surveyLabel: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    color: '#FFF',
    flex: 1,
  },
  surveysList: {
    paddingHorizontal: 20,
    gap: 12,
  },
  surveyItem: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  surveyItemGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
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
});
