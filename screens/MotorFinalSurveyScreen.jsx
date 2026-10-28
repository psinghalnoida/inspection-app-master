import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as DocumentPicker from 'expo-document-picker';
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
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SurveyorTeamPicker from '../components/SurveyorTeamPicker';
import { AppColors } from '../constants/theme';
import api, { describeApiError } from '../lib/api';

const LOCATION_OPTIONS = [
  { label: 'Coordinates', value: 'manual_coordinates' },
  { label: 'Manual Entry', value: 'pincode_entry' },
  { label: 'Maps Link', value: 'google_maps_link' },
  { label: 'SMS Link', value: 'sms_link' },
];

const CATEGORY_OPTIONS = ['private', 'commercial'];

const VEHICLE_TYPES = [
  { label: 'Motorcycle', value: 'motorcycle' },
  { label: 'Motor Car', value: 'motor_car' },
  { label: 'Tractor', value: 'tractor' },
  { label: 'Bus', value: 'bus' },
  { label: 'Goods Carrier', value: 'goods_carrier' },
  { label: 'Construction Equipment', value: 'construction_equipment' },
  { label: 'Others', value: 'others' },
];

export default function MotorFinalSurveyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [locationMethod, setLocationMethod] = useState('manual_coordinates');
  const [category, setCategory] = useState('private');
  const [isEmergency, setIsEmergency] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [showVehicleTypes, setShowVehicleTypes] = useState(false);

  // Direct-assignment selection (via admin-managed team picker)
  const [surveyorMobile, setSurveyorMobile] = useState('');
  const [canDirectAssign, setCanDirectAssign] = useState(true);

  const [formData, setFormData] = useState({
    contact_person_name: '',
    contact_person_mobile: '',
    case_reference: '', // Claim Number
    name_of_insured: '',
    policy_number: '',
    vehicle_type: '',
    vehicle_number: '',
    instructions: '', // Notes
    pincode: '',
    city: '',
    state: '',
    address: '', // Workshop Address
    latitude: '',
    longitude: '',
    google_maps_link: '',
    workshop_name: '',
    workshop_advisor_name: '',
    workshop_contact: ''
  });

  const [uploadedPhotos, setUploadedPhotos] = useState([]);
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});

  const updateForm = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    validateField(key, value);
  };

  const validateField = (key, value) => {
    let errorMsg = '';
    switch (key) {
      case 'contact_person_name':
        if (!value?.trim()) errorMsg = 'Contact person name is required';
        break;
      case 'contact_person_mobile':
        if (!value) errorMsg = 'Mobile number is required';
        else if (!/^\d+$/.test(value)) errorMsg = 'Only digits allowed';
        else if (value.length !== 10) errorMsg = 'Must be 10 digits';
        break;
      case 'case_reference':
        if (!value?.trim()) errorMsg = 'Claim number is required';
        break;
      case 'vehicle_number':
        if (!value?.trim()) errorMsg = 'Vehicle number is required';
        else if (!/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/i.test(value)) errorMsg = 'Invalid format (e.g., MH01AB1234)';
        break;
      case 'pincode':
        if (locationMethod === 'pincode_entry' && value && !/^\d{6}$/.test(value)) errorMsg = 'Must be 6 digits';
        break;
    }
    setFieldErrors(prev => ({ ...prev, [key]: errorMsg }));
    return errorMsg;
  };

  const handleBlur = (key) => validateField(key, formData[key]);

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
      // For creating a survey, typically assigners don't upload survey photos, but documents
      // If needed, we can map these to a specific document type or just 'others'
      const newDocs = result.assets.map(asset => ({
        uri: asset.uri,
        name: asset.fileName || 'photo.jpg',
        type: 'image/jpeg',
        document_type: 'others'
      }));
      setUploadedDocs(prev => [...prev, ...newDocs]);
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      multiple: true,
    });

    if (!result.canceled && result.assets) {
      const newDocs = result.assets.map(asset => ({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType,
        document_type: 'others',
        icon: asset.mimeType?.includes('pdf') ? 'picture-as-pdf' : 'image'
      }));
      setUploadedDocs(prev => [...prev, ...newDocs]);
    }
  };

  const removeDoc = (index) => {
    setUploadedDocs(prev => prev.filter((_, i) => i !== index));
  };

  const validateForm = () => {
    const required = [
      { key: 'contact_person_name', label: 'Contact Person Name' },
      { key: 'contact_person_mobile', label: 'Contact Person Mobile' },
      { key: 'case_reference', label: 'Claim Number' },
      { key: 'vehicle_type', label: 'Vehicle Type' },
      { key: 'vehicle_number', label: 'Vehicle Number' },
    ];

    if (locationMethod === 'manual_coordinates') {
      // Lat/Long optional if manually entered but good to have
    }

    if (locationMethod === 'google_maps_link' && !formData.google_maps_link?.trim()) {
      Alert.alert('Error', 'Please paste a Google Maps link.');
      return false;
    }

    for (const field of required) {
      if (!formData[field.key]) {
        Alert.alert('Error', `Please enter ${field.label}`);
        return false;
      }
    }

    if (formData.contact_person_mobile.length !== 10) {
      Alert.alert('Error', 'Please enter a valid 10-digit mobile number');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const submitData = new FormData();

      // Required fields
      submitData.append('survey_type', 'motor_final');
      submitData.append('contact_person_name', formData.contact_person_name);
      submitData.append('contact_person_mobile', formData.contact_person_mobile);
      submitData.append('location_method', locationMethod);
      submitData.append('case_reference', formData.case_reference);
      submitData.append('is_emergency', isEmergency.toString());

      // Motor specific
      submitData.append('vehicle_category', category);
      submitData.append('vehicle_type', formData.vehicle_type);
      submitData.append('vehicle_number', formData.vehicle_number);

      // Optional fields
      if (formData.latitude) submitData.append('latitude', formData.latitude);
      if (formData.longitude) submitData.append('longitude', formData.longitude);
      if (formData.pincode) submitData.append('pincode', formData.pincode);
      if (formData.city) submitData.append('city', formData.city);
      if (formData.state) submitData.append('state', formData.state);
      if (formData.address) submitData.append('address', formData.address);
      if (locationMethod === 'google_maps_link' && formData.google_maps_link) submitData.append('google_maps_link', formData.google_maps_link.trim());

      // Workshop details as separate fields
      if (formData.workshop_name) submitData.append('workshop_name', formData.workshop_name);
      if (formData.workshop_advisor_name) submitData.append('workshop_advisor_name', formData.workshop_advisor_name);
      if (formData.workshop_contact) submitData.append('workshop_advisor_contact', formData.workshop_contact);

      if (formData.name_of_insured) submitData.append('name_of_insured', formData.name_of_insured);
      if (formData.policy_number) submitData.append('policy_number', formData.policy_number);
      if (formData.instructions) submitData.append('instructions', formData.instructions);

      // Documents
      uploadedDocs.forEach((doc) => {
        submitData.append('documents', {
          uri: doc.uri,
          name: doc.name,
          type: doc.type,
        });
        // We need to send document_types array corresponding to documents
      });

      // Document types (array of strings)
      const docTypes = uploadedDocs.map(d => d.document_type || 'others');
      if (docTypes.length > 0) {
        submitData.append('document_types', JSON.stringify(docTypes));
      }

      // Surveyor direct assignment (optional)
      if (surveyorMobile.length === 10) {
        submitData.append('surveyor_mobile', surveyorMobile);
      }

      const response = await api.upload('/assigner/surveys', submitData);

      Alert.alert(
        'Success',
        'Motor Final Survey created successfully!',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(tabs)/survey'),
          },
        ]
      );
    } catch (error) {
      console.error('Submission error:', error);
      const { title, message } = describeApiError(error, 'Failed to create survey');
      Alert.alert(title, message);
    } finally {
      setLoading(false);
    }
  };

  const renderInput = (label, placeholder, key, keyboardType = 'default', required = false, autoCapitalize = 'sentences') => (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>
        {label} {required && <Text style={{ color: 'red' }}>*</Text>}
      </Text>
      <TextInput
        style={[styles.input, fieldErrors[key] ? styles.inputError : null]}
        placeholder={placeholder}
        placeholderTextColor="#999"
        value={formData[key]}
        onChangeText={(value) => updateForm(key, key === 'vehicle_number' ? value.toUpperCase().replace(/\s/g, '') : value)}
        onBlur={() => handleBlur(key)}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
      {fieldErrors[key] ? <Text style={styles.errorText}>{fieldErrors[key]}</Text> : null}
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
        <Text style={styles.headerTitle}>Motor Final Survey</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Contact Information */}
        {renderSection('person', 'Contact Information',
          <>
            {renderInput('Contact Person Name', 'Enter contact person name', 'contact_person_name', 'default', true)}
            {renderInput('Contact Person Mobile', 'Mobile no. (Enter whatsapp no. also)', 'contact_person_mobile', 'phone-pad', true)}
            {renderInput('Name of Insurer', 'Name of insured', 'name_of_insured')}
          </>
        )}

        {/* Location of Survey */}
        {renderSection('location-on', 'Location of Survey',
          <>
            <View style={styles.toggleContainer}>
              {LOCATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.toggleBtn,
                    locationMethod === option.value && styles.toggleBtnActive,
                  ]}
                  onPress={() => setLocationMethod(option.value)}
                >
                  <Text style={[
                    styles.toggleText,
                    locationMethod === option.value && styles.toggleTextActive,
                  ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {locationMethod === 'manual_coordinates' && (
              <>
                <TouchableOpacity style={styles.getLocationBtn} onPress={getLocation} disabled={gettingLocation}>
                  {gettingLocation ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
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
            {locationMethod === 'google_maps_link' && renderInput('Google Maps Link', 'https://maps.google.com/...', 'google_maps_link', 'url')}
            <Text style={{ fontSize: 11, color: '#999', marginTop: -8, marginBottom: 8 }}>Paste a maps link the surveyor can open for navigation.</Text>
          </>
        )}

        {/* Workshop (Optional) */}
        {renderSection('build', 'Workshop Details',
          <>
            {renderInput('Name of Workshop', 'Enter workshop name', 'workshop_name')}
            {renderInput('Workshop Advisor Name', 'Enter advisor name', 'workshop_advisor_name')}
            {renderInput('Workshop Contact Number', 'Enter workshop contact number', 'workshop_contact', 'phone-pad')}
          </>
        )}

        {/* Case Reference Details */}
        {renderSection('assignment', 'Case Reference Details',
          <>
            {renderInput('Claim Number', 'Enter claim number', 'case_reference', 'default', true)}
          </>
        )}

        {/* Insurance Details */}
        {renderSection('security', 'Insurance Details',
          <>
            {renderInput('Policy Number', 'Enter policy number', 'policy_number')}
          </>
        )}

        {/* Vehicle Information */}
        {renderSection('directions-car', 'Vehicle Information',
          <>
            <Text style={styles.inputLabel}>Category <Text style={{ color: 'red' }}>*</Text></Text>
            <View style={styles.radioRow}>
              {CATEGORY_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={styles.radioOption}
                  onPress={() => setCategory(option)}
                >
                  <View style={[styles.radio, category === option && styles.radioActive]}>
                    {category === option && <View style={styles.radioInner} />}
                  </View>
                  <Text style={styles.radioLabel}>{option.charAt(0).toUpperCase() + option.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Vehicle Type <Text style={{ color: 'red' }}>*</Text></Text>
              <TouchableOpacity style={styles.selectInput} onPress={() => setShowVehicleTypes(!showVehicleTypes)}>
                <Text style={styles.selectText}>
                  {formData.vehicle_type ? VEHICLE_TYPES.find(v => v.value === formData.vehicle_type)?.label : 'Select Vehicle Type'}
                </Text>
                <MaterialIcons name="keyboard-arrow-down" size={24} color="#666" />
              </TouchableOpacity>
              {showVehicleTypes && (
                <View style={styles.dropdown}>
                  {VEHICLE_TYPES.map((type) => (
                    <TouchableOpacity key={type.value} style={styles.dropdownItem} onPress={() => { setFormData({ ...formData, vehicle_type: type.value }); setShowVehicleTypes(false); }}>
                      <Text style={styles.dropdownText}>{type.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {renderInput('Vehicle Number', 'Enter vehicle number', 'vehicle_number', 'default', true, 'characters')}
          </>
        )}

        {/* Document Upload */}
        {renderSection('description', 'Document Upload',
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
            value={formData.instructions}
            onChangeText={(value) => updateForm('instructions', value)}
          />
        )}

        {/* Surveyor Direct Assignment - BEFORE Survey Type */}
        {canDirectAssign && renderSection('person', 'Assign Surveyor Directly (Optional)',
          <>
            <SurveyorTeamPicker
              value={surveyorMobile}
              onChange={setSurveyorMobile}
              surveyType="motor_final"
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
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitBtnText}>Submit Survey</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#FFF',
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  inputError: {
    borderColor: '#FF3B30',
    backgroundColor: '#FFF5F5',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginTop: 4,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  selectInput: {
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  selectText: {
    fontSize: 14,
    color: '#333',
  },
  dropdown: {
    marginTop: 4,
    backgroundColor: '#FFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    elevation: 2,
  },
  dropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  dropdownText: {
    color: '#333',
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#F0F0F0',
    borderRadius: 30,
    padding: 4,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 26,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: AppColors.primary,
  },
  toggleText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  toggleTextActive: {
    color: '#FFF',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CCC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: AppColors.primary,
    borderColor: AppColors.primary,
  },
  checkboxLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  getLocationBtn: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  getLocationText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  radioRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 16,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#CCC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioActive: {
    borderColor: AppColors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: AppColors.primary,
  },
  radioLabel: {
    fontSize: 14,
    color: '#333',
  },
  uploadArea: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  uploadAreaText: {
    fontSize: 13,
    color: '#999',
  },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  docName: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  docRemoveBtn: {
    padding: 4,
  },
  timingOptions: {
    gap: 12,
  },
  timingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  timingBtnActive: {
    borderColor: AppColors.primary,
    backgroundColor: '#F8F6FF',
  },
  timingLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  timingSublabel: {
    fontSize: 12,
    color: '#999',
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
  },
  submitBtn: {
    backgroundColor: AppColors.primary,
    borderRadius: 24,
    padding: 16,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
