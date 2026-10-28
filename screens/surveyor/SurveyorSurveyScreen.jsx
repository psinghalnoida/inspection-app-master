import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  RefreshControl,
  Platform
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useTabBarClearance } from '../../components/CustomTabBar';
import { AppColors } from '../../constants/theme';
import surveyorService from '../../lib/surveyorService';

const FILTERS = ['All', 'In Transit', 'Visit Location', 'Submitted', 'Completed'];

const getStatusColor = (status) => {
  switch (status) {
    case 'assigned': return { color: '#2196F3', bg: '#E3F2FD', label: 'Assigned' };
    case 'in_transit': return { color: '#FF9500', bg: '#FFF8E1', label: 'In Transit' };
    case 'reached':
    case 'location_detected':
    case 'location_shared': return { color: '#4CAF50', bg: '#E8F5E9', label: 'Visit Location' };
    case 'visit_completed':
    case 'report_submitted': return { color: '#03A9F4', bg: '#E1F5FE', label: 'Submitted' };
    case 'completed': return { color: '#9C27B0', bg: '#F3E5F5', label: 'Completed' };
    default: return { color: '#666', bg: '#F5F5F5', label: status?.replace(/_/g, ' ') || 'Unknown' };
  }
};

export default function SurveyorSurveyScreen() {
  const router = useRouter();
  const tabBarClearance = useTabBarClearance();
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSurveys = async () => {
    try {
      const data = await surveyorService.getSurveys();
      // Ensure data is array
      setSurveys(Array.isArray(data) ? data : (data.data || []));
    } catch (error) {
      console.error('Error fetching surveys:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSurveys();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSurveys();
  }, []);

  const filteredSurveys = surveys.filter((survey) => {
    const status = survey.status;
    let matchesFilter = true;

    if (activeFilter === 'In Transit') matchesFilter = status === 'in_transit';
    else if (activeFilter === 'Visit Location') matchesFilter = ['assigned', 'reached', 'location_detected', 'location_shared'].includes(status);
    else if (activeFilter === 'Submitted') matchesFilter = ['visit_completed', 'report_submitted'].includes(status);
    else if (activeFilter === 'Completed') matchesFilter = status === 'completed';

    const matchesSearch =
      searchText === '' ||
      (survey.case_reference?.toLowerCase().includes(searchText.toLowerCase())) ||
      (survey.vehicle_number?.toLowerCase().includes(searchText.toLowerCase())) ||
      (survey.survey_type?.toLowerCase().includes(searchText.toLowerCase()));

    return matchesFilter && matchesSearch;
  });

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-IN', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>My Surveys</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <MaterialIcons name="search" size={24} color="#999" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search Case Ref, Vehicle..."
          placeholderTextColor="#999"
          value={searchText}
          onChangeText={setSearchText}
        />
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterContainer}
          contentContainerStyle={styles.filterContent}
        >
          {FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.filterTab,
                activeFilter === filter && styles.filterTabActive,
              ]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text
                style={[
                  styles.filterText,
                  activeFilter === filter && styles.filterTextActive,
                ]}
              >
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Survey Cards */}
      {loading ? (
        <View style={[styles.centered, { flex: 1 }]}>
          <ActivityIndicator size="large" color={AppColors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[AppColors.primary]} />
          }
        >
          {filteredSurveys.length > 0 ? (
            filteredSurveys.map((survey, index) => {
              const statusConfig = getStatusColor(survey.status);
              return (
                <TouchableOpacity
                  key={index}
                  style={styles.surveyCard}
                  onPress={() => router.push(`/survey-detail/${survey.id}`)}
                >
                  {/* Header with Case Ref and Status */}
                  <View style={[styles.cardHeader, { backgroundColor: statusConfig.bg }]}>
                    <Text style={styles.caseRef}>Ref: {survey.case_reference || 'N/A'}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: '#FFF' }]}>
                      <Text style={[styles.statusText, { color: statusConfig.color }]}>
                        {statusConfig.label}
                      </Text>
                    </View>
                  </View>

                  {/* Map Preview */}
                  <View style={styles.mapContainer}>
                    {survey.latitude && survey.longitude ? (
                      <MapView
                        style={styles.map}
                        initialRegion={{
                          latitude: parseFloat(survey.latitude),
                          longitude: parseFloat(survey.longitude),
                          latitudeDelta: 0.01,
                          longitudeDelta: 0.01,
                        }}
                        scrollEnabled={false}
                        zoomEnabled={false}
                        pitchEnabled={false}
                        rotateEnabled={false}
                      >
                        <Marker
                          coordinate={{
                            latitude: parseFloat(survey.latitude),
                            longitude: parseFloat(survey.longitude),
                          }}
                        >
                          <View style={styles.mapMarker}>
                            <MaterialIcons name="location-on" size={28} color={AppColors.primary} />
                          </View>
                        </Marker>
                      </MapView>
                    ) : (
                      <View style={styles.mapPlaceholder}>
                        <MaterialIcons
                          name={survey.survey_type?.includes('motor') ? 'directions-car' : 'directions-boat'}
                          size={48}
                          color="#CCC"
                        />
                        <Text style={styles.noLocationText}>Location not available</Text>
                      </View>
                    )}
                  </View>

                  {/* Details */}
                  <View style={styles.cardBody}>
                    <View style={styles.infoRow}>
                      <MaterialIcons name="category" size={16} color="#666" />
                      <Text style={styles.infoText}>
                        {survey.survey_type?.replace(/_/g, ' ').toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <MaterialIcons name="location-city" size={16} color="#666" />
                      <Text style={styles.infoText} numberOfLines={1}>
                        {survey.address || `${survey.city || ''}, ${survey.state || ''}`}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <MaterialIcons name="event" size={16} color="#666" />
                      <Text style={styles.infoText}>{formatDate(survey.created_at)}</Text>
                    </View>

                    {/* Footer */}
                    <View style={styles.cardFooter}>
                      <View style={styles.distanceContainer}>
                        <MaterialIcons name="near-me" size={14} color={AppColors.primary} />
                        <Text style={styles.distancePrice}>
                          {survey.distance_km !== null && survey.distance_km !== undefined
                            ? `${survey.distance_km} km away`
                            : 'Distance N/A'}
                        </Text>
                      </View>
                      <TouchableOpacity style={styles.actionBtn}>
                        <Text style={styles.actionBtnText}>View Details</Text>
                        <MaterialIcons name="arrow-forward" size={14} color={AppColors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <MaterialIcons name="assignment-late" size={64} color="#DDD" />
              <Text style={styles.emptyStateText}>No surveys found</Text>
            </View>
          )}
          <View style={{ height: tabBarClearance }} />
        </ScrollView>
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#FFF',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1A1A1A',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    marginHorizontal: 20,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  filterWrapper: {
    height: 60,
  },
  filterContainer: {
    marginTop: 10,
    maxHeight: 50,
  },
  filterContent: {
    paddingHorizontal: 20,
    gap: 8,
    paddingBottom: 10,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginRight: 8,
    height: 36,
    justifyContent: 'center',
  },
  filterTabActive: {
    backgroundColor: AppColors.primary,
    borderColor: AppColors.primary,
  },
  filterText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  filterTextActive: {
    color: '#FFF',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    gap: 16,
  },
  surveyCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  caseRef: {
    fontSize: 12,
    color: '#333',
    flex: 1,
    marginRight: 8,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  mapContainer: {
    height: 120,
    backgroundColor: '#E8E8E8',
    overflow: 'hidden',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  mapMarker: {
    backgroundColor: '#FFF',
    padding: 4,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  mapPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  noLocationText: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  cardBody: {
    padding: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  infoText: {
    fontSize: 12,
    color: '#666',
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  distanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  distancePrice: {
    fontSize: 13,
    color: AppColors.primary,
    fontWeight: '600',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionBtnText: {
    fontSize: 12,
    color: AppColors.primary,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    color: '#999',
    fontSize: 16,
    marginTop: 16,
  },
});
