import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../app/_layout';
import { useTabBarClearance } from '../components/CustomTabBar';
import { AppColors } from '../constants/theme';
import api from '../lib/api';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending_assignment', label: 'Pending' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'finished', label: 'Completed' },
];

const getStatusConfig = (status) => {
  switch (status) {
    case 'pending_assignment':
    case 'pending_payment':
      return { color: '#FF6B6B', bgColor: '#FFF0F0', label: 'Pending', borderColor: '#FFCDD2' };
    case 'assigned':
      return { color: '#FF9500', bgColor: '#FFF8E1', label: 'Assigned', borderColor: '#FFE0B2' };
    case 'location_detected':
    case 'location_shared':
      return { color: '#2196F3', bgColor: '#E3F2FD', label: 'Location Detected', borderColor: '#BBDEFB' };
    case 'in_progress':
    case 'in_transit':
    case 'reached':
      return { color: '#4CAF50', bgColor: '#E8F5E9', label: 'In progress', borderColor: '#C8E6C9' };
    case 'photos_uploaded':
    case 'report_submitted':
      return { color: '#03A9F4', bgColor: '#E1F5FE', label: 'Report Submitted', borderColor: '#B3E5FC' };
    case 'completed':
    case 'finished':
      return { color: '#9C27B0', bgColor: '#F3E5F5', label: 'Completed', borderColor: '#E1BEE7' };
    case 'cancelled':
      return { color: '#757575', bgColor: '#F5F5F5', label: 'Cancelled', borderColor: '#E0E0E0' };
    default:
      return { color: '#666', bgColor: '#F5F5F5', label: status?.replace(/_/g, ' ') || 'Unknown', borderColor: '#E0E0E0' };
  }
};

const formatSurveyType = (type) => {
  if (!type) return '';
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export default function SurveyScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const tabBarClearance = useTabBarClearance();
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 });

  useEffect(() => {
    fetchSurveys();
  }, [statusFilter]);

  const fetchSurveys = async (page = 1) => {
    try {
      const params = { page, limit: pagination.limit };
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;

      const response = await api.get('/assigner/surveys', params);

      if (page === 1) {
        setSurveys(response.data || []);
      } else {
        setSurveys(prev => [...prev, ...(response.data || [])]);
      }

      setPagination(prev => ({
        ...prev,
        page,
        total: response.pagination?.total || 0,
      }));
    } catch (error) {
      console.error('Surveys fetch error:', error);
      // Auto logout only for actual session/auth errors
      if (error.message?.includes('Session expired') ||
        error.message?.includes('Token expired') ||
        error.message?.includes('Invalid token') ||
        error.message?.includes('No token') ||
        error.message?.includes('Unauthorized') ||
        error.status === 401) {
        Alert.alert(
          'Session Expired',
          'Your session has expired. Please login again.',
          [{ text: 'OK', onPress: () => signOut() }]
        );
        return;
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSurveys(1);
  }, [statusFilter, search]);

  const handleLoadMore = () => {
    if (surveys.length < pagination.total && !loading) {
      fetchSurveys(pagination.page + 1);
    }
  };

  const handleSearch = () => {
    setLoading(true);
    fetchSurveys(1);
  };

  const handleSurveyPress = (survey) => {
    router.push(`/survey-detail/${survey.id}`);
  };

  const renderSurveyCard = ({ item: survey }) => {
    const statusConfig = getStatusConfig(survey.status);
    const hasAssignee = survey.surveyor_name;
    const isPending = survey.status === 'pending_assignment' || survey.status === 'pending_payment';
    const isCompleted = survey.status === 'completed' || survey.status === 'finished';

    return (
      <View style={[styles.cardWrapper, { borderColor: statusConfig.color }]}>
        <TouchableOpacity
          style={styles.surveyCard}
          onPress={() => handleSurveyPress(survey)}
          activeOpacity={0.7}
        >
          {/* Large colored header */}
          <View style={[styles.cardHeader, { backgroundColor: statusConfig.bgColor }]}>
            <Text style={[styles.caseRef, { color: statusConfig.color }]} numberOfLines={2}>
              Case Ref: #{survey.laid || survey.case_reference || `S-${survey.id}`} • {formatSurveyType(survey.survey_type)}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: '#FFF' }]}>
              <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
            </View>
          </View>

          {/* Contact Info */}
          <View style={styles.cardBody}>
            <Text style={styles.insuredName}>{survey.name_of_insured || survey.contact_person_name || 'N/A'}</Text>

            <View style={styles.infoRow}>
              <MaterialIcons name="phone" size={18} color="#888" />
              <Text style={styles.infoText}>{survey.contact_person_mobile ? `+91 ${survey.contact_person_mobile}` : 'N/A'}</Text>
            </View>

            <View style={styles.infoRow}>
              <MaterialIcons name="location-on" size={18} color="#2196F3" />
              <Text style={styles.infoText} numberOfLines={1}>
                {survey.address || (survey.city && survey.state ? `${survey.city}, ${survey.state}` : 'Location not set')}
                {survey.pincode ? `, ${survey.pincode}` : ''}
              </Text>
            </View>

            {/* Surveyor Assignment - Hidden when status is 'assigned' (before payment) */}
            {hasAssignee && survey.status !== 'assigned' && (
              <View style={styles.assigneeRow}>
                <View style={styles.assigneeInfo}>
                  <View style={styles.assigneeAvatarPlaceholder}>
                    <MaterialIcons name="person" size={22} color="#9B89EB" />
                  </View>
                  <View>
                    <Text style={styles.assignedLabel}>Assigned to</Text>
                    <Text style={styles.assigneeName}>{survey.surveyor_name}</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Payment Required - Show when status is 'assigned' */}
            {survey.status === 'assigned' && (
              <View style={styles.paymentRequiredRow}>
                <MaterialIcons name="lock" size={20} color="#FF9500" />
                <Text style={styles.paymentRequiredText}>Payment required to unlock surveyor</Text>
              </View>
            )}

            {/* Action Buttons */}
            {isPending && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: statusConfig.color }]}>
                <Text style={styles.actionBtnText}>Assign</Text>
              </TouchableOpacity>
            )}

            {/* {isCompleted && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#4CAF50' }]}>
                <Text style={styles.actionBtnText}>View Report</Text>
              </TouchableOpacity>
            )} */}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[AppColors.gradientEnd, AppColors.primary]}
        style={styles.headerGradient}
      >
        <Text style={styles.headerTitle}>My Surveys</Text>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <MaterialIcons name="search" size={20} color="#999" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by case reference..."
            placeholderTextColor="#999"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
        </View>

        {/* Status Filters */}
        <FlatList
          horizontal
          data={STATUS_FILTERS}
          keyExtractor={item => item.label}
          showsHorizontalScrollIndicator={false}
          style={styles.filterList}
          contentContainerStyle={{ paddingBottom: 4 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.filterChip, statusFilter === item.value && styles.filterChipActive]}
              onPress={() => {
                if (statusFilter !== item.value) {
                  setStatusFilter(item.value);
                  setLoading(true);
                } else {
                  // Re-fetch when tapping the same filter
                  onRefresh();
                }
              }}
            >
              <Text style={[styles.filterChipText, statusFilter === item.value && styles.filterChipTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </LinearGradient>

      {loading && surveys.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={AppColors.primary} />
        </View>
      ) : surveys.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="assignment" size={64} color="#CCC" />
          <Text style={styles.emptyTitle}>No Surveys Found</Text>
          <Text style={styles.emptySubtitle}>
            {statusFilter ? 'Try changing the filter' : 'Create your first survey to get started'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={surveys}
          keyExtractor={item => item.id.toString()}
          renderItem={renderSurveyCard}
          contentContainerStyle={[styles.listContent, { paddingBottom: tabBarClearance }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={AppColors.primary} />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            surveys.length < pagination.total ? (
              <ActivityIndicator style={{ padding: 20 }} color={AppColors.primary} />
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerGradient: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#333',
  },
  filterList: {
    marginTop: 12,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#FFF',
  },
  filterChipText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: AppColors.primary,
  },
  listContent: {
    padding: 16,
    paddingBottom: 120,
  },
  cardWrapper: {
    marginBottom: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: 'hidden',
    backgroundColor: '#FFF',
  },
  surveyCard: {
    backgroundColor: '#FFF',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  caseRef: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 12,
    lineHeight: 20,
  },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardBody: {
    padding: 16,
    paddingTop: 16,
  },
  insuredName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  infoText: {
    fontSize: 15,
    color: '#555',
    flex: 1,
  },
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  assigneeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  assigneeAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#EEE',
  },
  assigneeAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E9D5FF',
  },
  assignedLabel: {
    fontSize: 12,
    color: '#999',
  },
  assigneeName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  chatBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: AppColors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 12,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#999',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#BBB',
    textAlign: 'center',
    marginTop: 8,
  },
  paymentRequiredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  paymentRequiredText: {
    fontSize: 13,
    color: '#FF9500',
    fontWeight: '600',
    flex: 1,
  },
});
