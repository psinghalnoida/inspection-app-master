import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors } from '../constants/theme';
import api, { describeApiError } from '../lib/api';
import SurveyorTeamPicker from '../components/SurveyorTeamPicker';

const LOCATION_OPTIONS = [
  { label: 'Coordinates', value: 'manual_coordinates' },
  { label: 'Manual Entry', value: 'pincode_entry' },
  { label: 'Maps Link', value: 'google_maps_link' },
  { label: 'SMS Link', value: 'sms_link' },
];

const TIMING_OPTIONS = [
  { label: 'Regular Survey', sublabel: '(7 AM Onwards)' },
  { label: 'Emergency Survey', sublabel: '(After 5 PM)' },
];

const PRICING = [
  { label: 'Within 25 km', price: '₹ 2,500' },
  { label: '25-50 km', price: '₹ 3,500' },
  { label: 'Beyond 50 km', price: '₹ 5,000' },
];

const INVESTIGATION_LOSS_TYPES = [
  { label: 'Vehicle', value: 'vehicle' },
  { label: 'Cattle', value: 'cattle' },
  { label: 'Human', value: 'human' },
  { label: 'Others', value: 'others' }
];

export default function InspectionInvestigationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [surveyType, setSurveyType] = useState('Inspection'); // 'Inspection' (maps to others) or 'Investigation'
  const [locationMethod, setLocationMethod] = useState('manual_coordinates');
  const [isEmergency, setIsEmergency] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [investigationType, setInvestigationType] = useState('others'); // Default for Inspection
  const [showDropdown, setShowDropdown] = useState(false);

  // Surveyor direct assign state
  const [surveyorMobile, setSurveyorMobile] = useState('');
  const [canDirectAssign, setCanDirectAssign] = useState(true);

  const [formData, setFormData] = useState({
    itemsToInspect: '', // Maps to other_loss_item_name
    contactName: '',
    contactMobile: '',
    pincode: '',
    city: '',
    state: '',
    address: '',
    latitude: '',
    longitude: '',
    googleMapsLink: '',
    claimNumber: '',
    assignmentId: '', // Not used in backend submit but good for UI
    insuredName: '',
    policyNumber: '',
    notes: '',

    // Investigation Specific
    vehicleNumber: '',
    cattleTagNumber: '',
    cattleName: '',
    humanName: '',
    humanContact: '',
    humanRelation: '',
    otherLossName: ''
  });

  const [uploadedPhotos, setUploadedPhotos] = useState([]);
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [isAtSpot, setIsAtSpot] = useState(true);

  const updateForm = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const getLocation = async () => {
    setGettingLocation(true);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission to access location was denied');
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setFormData(prev => ({
        ...prev,
        latitude: location.coords.latitude.toString(),
        longitude: location.coords.longitude.toString()
      }));
      Alert.alert('Success', 'Location detected successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to get location');
    } finally {
      setGettingLocation(false);
    }
  };

  const pickImage = async () => {
    // Uses the Android system photo picker (no media permissions required).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets) {
      const newDocs = result.assets.map(asset => ({
        uri: asset.uri,
        name: asset.fileName || 'photo.jpg',
        type: 'image/jpeg',
        document_type: 'others'
      }));
      setUploadedDocs(prev => [...prev, ...newDocs]);

      const newPhotos = result.assets.map((asset) => asset.uri);
      setUploadedPhotos((prev) => [...prev, ...newPhotos]);
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      multiple: true,
    });
    if (!result.canceled && result.assets) {
      const newDocs = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType,
        document_type: 'others',
        icon: asset.mimeType?.includes('pdf') ? 'picture-as-pdf' : 'image',
      }));
      setUploadedDocs((prev) => [...prev, ...newDocs]);
    }
  };

  const removePhoto = (index) => {
    // Need to remove from uploadedDocs as well if we are tracking them together there
    // For now just removing from display
    setUploadedPhotos((prev) => prev.filter((_, i) => i !== index));
    // Also remove from docs list if it's there
    // Ideally we should manage one list. Separating visual only.
  };

  const removeDoc = (index) => {
    setUploadedDocs((prev) => prev.filter((_, i) => i !== index));
  };


  const validateForm = () => {
    const required = [
      { key: 'contactName', label: 'Contact Person Name' },
      { key: 'contactMobile', label: 'Contact Person Mobile' },
      { key: 'claimNumber', label: 'Claim Number' },
    ];

    for (const field of required) {
      if (!formData[field.key]) {
        Alert.alert('Error', `Please enter ${field.label}`);
        return false;
      }
    }

    if (formData.contactMobile.length !== 10) {
      Alert.alert('Error', 'Please enter a valid 10-digit mobile number');
      return false;
    }

    if (locationMethod === 'google_maps_link' && !formData.googleMapsLink?.trim()) {
      Alert.alert('Error', 'Please paste a Google Maps link.');
      return false;
    }

    // Validation based on type
    const currentType = surveyType === 'Inspection' ? 'others' : investigationType;

    if (currentType === 'others') {
      const val = surveyType === 'Inspection' ? formData.itemsToInspect : formData.otherLossName;
      if (!val) {
        Alert.alert('Error', 'Please enter description of items/loss');
        return false;
      }
    } else if (currentType === 'vehicle') {
      if (!formData.vehicleNumber) {
        Alert.alert('Error', 'Please enter vehicle number');
        return false;
      }
      if (!/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/i.test(formData.vehicleNumber)) {
        Alert.alert('Error', 'Invalid vehicle number format (e.g., MH01AB1234)');
        return false;
      }
    } else if (currentType === 'cattle') {
      if (!formData.cattleTagNumber || !formData.cattleName) {
        Alert.alert('Error', 'Please enter cattle details');
        return false;
      }
    } else if (currentType === 'human') {
      if (!formData.humanName || !formData.humanContact || !formData.humanRelation) {
        Alert.alert('Error', 'Please enter human loss details');
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const submitData = new FormData();

      submitData.append('survey_type', 'investigation');
      submitData.append('contact_person_name', formData.contactName);
      submitData.append('contact_person_mobile', formData.contactMobile);
      submitData.append('location_method', locationMethod);
      submitData.append('case_reference', formData.claimNumber);
      submitData.append('is_emergency', isEmergency.toString());
      submitData.append('name_of_insured', formData.insuredName);
      submitData.append('policy_number', formData.policyNumber);

      const finalLossItemType = surveyType === 'Inspection' ? 'others' : investigationType;
      submitData.append('loss_item_type', finalLossItemType);

      if (finalLossItemType === 'others') {
        submitData.append('other_loss_item_name', surveyType === 'Inspection' ? formData.itemsToInspect : formData.otherLossName);
      } else if (finalLossItemType === 'vehicle') {
        submitData.append('investigation_vehicle_number', formData.vehicleNumber);
      } else if (finalLossItemType === 'cattle') {
        submitData.append('cattle_tag_number', formData.cattleTagNumber);
        submitData.append('cattle_name', formData.cattleName);
      } else if (finalLossItemType === 'human') {
        submitData.append('human_name', formData.humanName);
        submitData.append('human_contact_number', formData.humanContact);
        submitData.append('human_relation', formData.humanRelation);
      }

      if (formData.latitude) submitData.append('latitude', formData.latitude);
      if (formData.longitude) submitData.append('longitude', formData.longitude);
      if (formData.pincode) submitData.append('pincode', formData.pincode);
      if (formData.city) submitData.append('city', formData.city);
      if (formData.state) submitData.append('state', formData.state);
      if (formData.address) submitData.append('address', formData.address);
      if (locationMethod === 'google_maps_link' && formData.googleMapsLink) submitData.append('google_maps_link', formData.googleMapsLink.trim());
      if (formData.notes) submitData.append('instructions', formData.notes);

      // Documents
      uploadedDocs.forEach((doc) => {
        submitData.append('documents', {
          uri: doc.uri,
          name: doc.name,
          type: doc.type,
        });
      });

      const docTypes = uploadedDocs.map(d => d.document_type || 'others');
      if (docTypes.length > 0) {
        submitData.append('document_types', JSON.stringify(docTypes));
      }

      // Surveyor direct assignment (optional)
      if (surveyorMobile.length === 10) {
        submitData.append('surveyor_mobile', surveyorMobile);
      }

      await api.upload('/assigner/surveys', submitData);

      Alert.alert(
        'Success',
        'Investigation Survey created successfully!',
        [{ text: 'OK', onPress: () => router.replace('/(tabs)/survey') }]
      );

    } catch (error) {
      console.error('Submission error:', error);
      const { title, message } = describeApiError(error, 'Failed to create survey');
      Alert.alert(title, message);
    } finally {
      setLoading(false);
    }
  };

  const renderInput = (label, placeholder, key, keyboardType = 'default', required = false, autoCapitalize = 'none') => (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label} {required && <Text style={{ color: 'red' }}>*</Text>}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#999"
        value={formData[key]}
        onChangeText={(value) => updateForm(key, key === 'vehicleNumber' ? value.toUpperCase().replace(/\s/g, '') : value)}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );

  const renderSection = (icon, title, children) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <MaterialIcons name={icon} size={20} color={AppColors.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Inspection / Investigation</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Type Toggle */}
      <View style={styles.typeToggleContainer}>
        <TouchableOpacity
          style={[styles.typeToggleBtn, surveyType === 'Inspection' && styles.typeToggleBtnActive]}
          onPress={() => { setSurveyType('Inspection'); setInvestigationType('others'); }}
        >
          <View style={[styles.radioCircle, surveyType === 'Inspection' && styles.radioCircleActive]}>
            {surveyType === 'Inspection' && <View style={styles.radioInnerCircle} />}
          </View>
          <Text style={[styles.typeToggleText, surveyType === 'Inspection' && styles.typeToggleTextActive]}>
            Inspection
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeToggleBtn, surveyType === 'Investigation' && styles.typeToggleBtnActive]}
          onPress={() => { setSurveyType('Investigation'); setInvestigationType('vehicle'); }}
        >
          <View style={[styles.radioCircle, surveyType === 'Investigation' && styles.radioCircleActive]}>
            {surveyType === 'Investigation' && <View style={styles.radioInnerCircle} />}
          </View>
          <Text style={[styles.typeToggleText, surveyType === 'Investigation' && styles.typeToggleTextActive]}>
            Investigation
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >

        {/* Items to be Inspect - Only show for Inspection */}
        {surveyType === 'Inspection' && renderSection('checklist', 'Items to be Inspect',
          <View style={styles.inputGroup}>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="List of details of the item(s) to be inspected."
              placeholderTextColor="#999"
              multiline
              numberOfLines={3}
              value={formData.itemsToInspect}
              onChangeText={(value) => updateForm('itemsToInspect', value)}
            />
          </View>
        )}

        {/* Investigation Type - Only show for Investigation */}
        {surveyType === 'Investigation' && renderSection('indeterminate-check-box', 'Investigation Details',
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Investigation Type</Text>
              <TouchableOpacity
                style={styles.dropdown}
                onPress={() => setShowDropdown(!showDropdown)}
              >
                <Text style={[styles.dropdownText, investigationType && { color: '#333' }]}>
                  {INVESTIGATION_LOSS_TYPES.find(t => t.value === investigationType)?.label || 'Select Type'}
                </Text>
                <MaterialIcons name="keyboard-arrow-down" size={24} color="#999" />
              </TouchableOpacity>
            </View>

            {showDropdown && (
              <View style={styles.dropdownList}>
                {INVESTIGATION_LOSS_TYPES.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={styles.dropdownItem}
                    onPress={() => {
                      setInvestigationType(option.value);
                      setShowDropdown(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{option.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {investigationType === 'vehicle' && (
              renderInput('Vehicle Number', 'e.g., MH01AB1234', 'vehicleNumber', 'default', true, 'characters')
            )}

            {investigationType === 'cattle' && (
              <>
                {renderInput('Tag Number', 'Enter tag number', 'cattleTagNumber')}
                {renderInput('Cattle Name', 'Enter cattle name', 'cattleName')}
              </>
            )}

            {investigationType === 'human' && (
              <>
                {renderInput('Person Name', 'Enter name', 'humanName')}
                {renderInput('Contact Number', 'Enter contact number', 'humanContact', 'phone-pad')}
                {renderInput('Relation', 'Enter relation', 'humanRelation')}
              </>
            )}

            {investigationType === 'others' && (
              renderInput('Loss Item Name', 'Enter loss item name', 'otherLossName')
            )}

          </>
        )}

        {/* Contact Information */}
        {renderSection('person', 'Contact Information',
          <>
            {renderInput('Contact Person Name', 'Enter contact person name', 'contactName', 'default', true)}
            {renderInput('Contact Person Mobile', 'Mobile no. (Enter whatsapp no. also)', 'contactMobile', 'phone-pad', true)}
          </>
        )}

        {/* Location of Survey */}
        {renderSection('location-on', 'Location of Survey',
          <>
            <View style={styles.toggleContainer}>
              {LOCATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.toggleBtn, locationMethod === option.value && styles.toggleBtnActive]}
                  onPress={() => setLocationMethod(option.value)}
                >
                  <Text style={[styles.toggleText, locationMethod === option.value && styles.toggleTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {locationMethod === 'manual_coordinates' && (
              <>
                <TouchableOpacity style={styles.getLocationBtn} onPress={getLocation} disabled={gettingLocation}>
                  {gettingLocation ? <ActivityIndicator color="#FFF" /> : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <MaterialIcons name="my-location" size={20} color="#FFF" />
                      <Text style={styles.getLocationText}>Auto-detect Location</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <Text style={{ textAlign: 'center', color: '#666', marginVertical: 8 }}>OR</Text>
                {renderInput('Longitude', 'Enter longitude', 'longitude', 'numeric')}
                {renderInput('Latitude', 'Enter latitude', 'latitude', 'numeric')}
              </>
            )}

            {locationMethod === 'pincode_entry' && (
              <>
                {renderInput('Pin Code', 'Enter pin code', 'pincode', 'number-pad')}
                {renderInput('City', 'Enter city', 'city')}
                {renderInput('State', 'Enter state', 'state')}
                {renderInput('Address', 'Enter full address', 'address')}
              </>
            )}
            {locationMethod === 'google_maps_link' && renderInput('Google Maps Link', 'https://maps.google.com/...', 'googleMapsLink', 'url')}
            <Text style={{ fontSize: 11, color: '#999', marginTop: -8, marginBottom: 8 }}>Paste a maps link the surveyor can open for navigation.</Text>
          </>
        )}

        {/* Case Reference Details */}
        {renderSection('assignment', 'Case Reference Details',
          <>
            {renderInput('Claim Number', 'Enter claim number', 'claimNumber', 'default', true)}
          </>
        )}

        {/* Insurance Details */}
        {renderSection('security', 'Insurance Details',
          <>
            {renderInput('Name of Insured', 'Enter insured name', 'insuredName')}
            {renderInput('Policy Number', 'Enter policy number', 'policyNumber')}
          </>
        )}

        {/* Photos Upload */}
        {renderSection('photo-camera', 'Photos Upload',
          <>
            <TouchableOpacity style={styles.uploadArea} onPress={pickImage}>
              <MaterialIcons name="cloud-upload" size={24} color="#999" />
              <Text style={styles.uploadAreaText}>Upload Photos</Text>
            </TouchableOpacity>
            {uploadedPhotos.length > 0 && (
              <View style={styles.uploadRow}>
                {/* Only showing first 5 for preview if too many */}
                {uploadedPhotos.map((photo, index) => (
                  <View key={index} style={styles.photoWrapper}>
                    <Image source={{ uri: photo }} style={styles.uploadedPhoto} />
                    <TouchableOpacity style={styles.removeBtn} onPress={() => removePhoto(index)}>
                      <MaterialIcons name="close" size={14} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* Document Upload */}
        {renderSection('folder', 'Document Upload',
          <>
            <TouchableOpacity style={styles.uploadArea} onPress={pickDocument}>
              <MaterialIcons name="cloud-upload" size={24} color="#999" />
              <Text style={styles.uploadAreaText}>Browse Files</Text>
            </TouchableOpacity>
            {uploadedDocs.map((doc, index) => (
              <View key={index} style={styles.docItem}>
                <MaterialIcons name={doc.icon || 'insert-drive-file'} size={20} color="#FF3B30" />
                <Text style={styles.docName} numberOfLines={1}>{doc.name}</Text>
                <TouchableOpacity style={styles.docRemoveBtn} onPress={() => removeDoc(index)}>
                  <MaterialIcons name="close" size={18} color="#999" />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* Instructions / Additional Notes */}
        {renderSection('edit-note', 'Instructions / Additional Notes',
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Enter any additional details for the surveyor..."
            placeholderTextColor="#999"
            multiline
            numberOfLines={4}
            value={formData.notes}
            onChangeText={(value) => updateForm('notes', value)}
          />
        )}

        {/* Surveyor Direct Assignment - BEFORE Survey Type */}
        {canDirectAssign && renderSection('person', 'Assign Surveyor Directly (Optional)',
          <>
            <SurveyorTeamPicker
              value={surveyorMobile}
              onChange={setSurveyorMobile}
              surveyType="investigation"
              onAvailabilityChange={setCanDirectAssign}
            />
            <Text style={{ color: '#666', fontSize: 12, marginTop: 8 }}>
              Pick a surveyor from your team to assign directly (skips broadcast). Leave empty to broadcast.
            </Text>
          </>
        )}

        {/* Survey Type */}
        {renderSection('schedule', 'Survey Type',
          <View style={styles.timingOptions}>
            <TouchableOpacity
              style={[styles.timingBtn, !isEmergency && styles.timingBtnActive]}
              onPress={() => setIsEmergency(false)}
            >
              <View style={[styles.radio, !isEmergency && styles.radioActive]}>
                {!isEmergency && <View style={styles.radioInner} />}
              </View>
              <Text style={styles.timingLabel}>Regular Survey</Text>
              <Text style={styles.timingSublabel}>(7 AM - 5 PM)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.timingBtn, isEmergency && styles.timingBtnActive]}
              onPress={() => setIsEmergency(true)}
            >
              <View style={[styles.radio, isEmergency && styles.radioActive]}>
                {isEmergency && <View style={styles.radioInner} />}
              </View>
              <Text style={styles.timingLabel}>Emergency Survey</Text>
              <Text style={styles.timingSublabel}>(After 5 PM)</Text>
            </TouchableOpacity>
          </View>
        )}


        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Submit Button */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Submit Survey</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#FFF',
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#1A1A1A' },
  typeToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  typeToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeToggleBtnActive: {},
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#CCC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleActive: { borderColor: AppColors.primary },
  radioInnerCircle: { width: 10, height: 10, borderRadius: 5, backgroundColor: AppColors.primary },
  typeToggleText: { fontSize: 14, color: '#666' },
  typeToggleTextActive: { color: AppColors.primary, fontWeight: '500' },
  content: { flex: 1 },
  scrollContent: { padding: 16 },
  section: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  inputGroup: { marginBottom: 12 },
  inputLabel: { fontSize: 13, color: '#666', marginBottom: 6 },
  input: { backgroundColor: '#F8F8F8', borderRadius: 8, padding: 12, fontSize: 14, color: '#333', borderWidth: 1, borderColor: '#E8E8E8' },
  textArea: { height: 80, textAlignVertical: 'top' },
  dropdown: {
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E8E8E8',
    marginBottom: 12,
  },
  dropdownText: { fontSize: 14, color: '#333' },
  dropdownList: {
    backgroundColor: '#FFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    marginBottom: 12,
    overflow: 'hidden',
  },
  dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  dropdownItemText: { fontSize: 14, color: '#333' },
  toggleContainer: { flexDirection: 'row', backgroundColor: '#F0F0F0', borderRadius: 30, padding: 4, marginBottom: 16 },
  toggleBtn: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 26, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: AppColors.primary },
  toggleText: { fontSize: 13, color: '#666', fontWeight: '500' },
  toggleTextActive: { color: '#FFF' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#CCC', justifyContent: 'center', alignItems: 'center' },
  checkboxActive: { backgroundColor: AppColors.primary, borderColor: AppColors.primary },
  checkboxLabel: { fontSize: 15, fontWeight: '500', color: '#333' },
  getLocationBtn: { backgroundColor: '#2196F3', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  getLocationText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  uploadArea: { borderWidth: 1, borderColor: '#E0E0E0', borderStyle: 'dashed', borderRadius: 8, padding: 20, alignItems: 'center', gap: 8, marginBottom: 12 },
  uploadAreaText: { fontSize: 13, color: '#999' },
  uploadRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 12 },
  photoWrapper: { position: 'relative' },
  uploadedPhoto: { width: 70, height: 70, borderRadius: 8 },
  removeBtn: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center' },
  addPhotoBtn: { width: 70, height: 70, borderRadius: 8, borderWidth: 1, borderColor: AppColors.primary, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  addPhotoText: { fontSize: 10, color: AppColors.primary, marginTop: 4 },
  docItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  docName: { fontSize: 14, color: '#333', flex: 1 },
  docRemoveBtn: { padding: 4 },
  timingOptions: { gap: 12 },
  timingBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E8E8E8' },
  timingBtnActive: { borderColor: AppColors.primary, backgroundColor: '#F8F6FF' },
  timingLabel: { fontSize: 14, fontWeight: '500', color: '#333' },
  timingSublabel: { fontSize: 12, color: '#999' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#CCC', justifyContent: 'center', alignItems: 'center' },
  radioActive: { borderColor: AppColors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: AppColors.primary },
  pricingList: { gap: 8 },
  pricingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  pricingLabel: { fontSize: 14, color: '#666' },
  pricingValue: { fontSize: 14, fontWeight: '600', color: AppColors.primary },
  textInput: {
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  footer: { padding: 16, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#E8E8E8' },
  submitBtn: { backgroundColor: AppColors.primary, borderRadius: 24, padding: 16, alignItems: 'center' },
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
