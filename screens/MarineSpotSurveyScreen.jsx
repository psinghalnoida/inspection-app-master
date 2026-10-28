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
  Modal
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
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
  { label: 'Within 25 km', price: '₹ 2,000' },
  { label: '25-50 km', price: '₹ 2,500' },
  { label: 'Beyond 50 km', price: '₹ 5,000' },
];

export default function MarineSpotSurveyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [locationMethod, setLocationMethod] = useState('manual_coordinates');
  const [isEmergency, setIsEmergency] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);

  // Surveyor direct assign state
  const [surveyorMobile, setSurveyorMobile] = useState('');
  const [canDirectAssign, setCanDirectAssign] = useState(true);

  const [formData, setFormData] = useState({
    contact_person_name: '',
    contact_person_mobile: '',
    case_reference: '',
    name_of_insured: '',
    policy_number: '',
    name_of_consignee: '',
    name_of_consignor: '',
    commodity: '',
    instructions: '',
    pincode: '',
    city: '',
    state: '',
    address: '',
    latitude: '',
    longitude: '',
    google_maps_link: '',
  });

  const [invoices, setInvoices] = useState([{ invoice_number: '', invoice_date: '', invoice_amount: '', policy_number: '', file: null }]);
  const [grItems, setGrItems] = useState([{ gr_number: '', gr_date: '', file: null }]);
  const [uploadedPhotos, setUploadedPhotos] = useState([]);
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [activeDateField, setActiveDateField] = useState(null); // { type: 'invoice'|'gr'|'lr', index: number }
  const [tempDate, setTempDate] = useState(new Date());

  const addInvoice = () => {
    setInvoices([...invoices, { invoice_number: '', invoice_date: '', invoice_amount: '', policy_number: '', file: null }]);
  };

  const updateInvoice = (index, field, value) => {
    const updated = [...invoices];
    updated[index][field] = value;
    setInvoices(updated);
  };

  const pickInvoiceFile = async (index) => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
    if (!result.canceled && result.assets && result.assets[0]) {
      updateInvoice(index, 'file', result.assets[0]);
    }
  };

  const addGR = () => {
    setGrItems([...grItems, { gr_number: '', gr_date: '', file: null }]);
  };

  const updateGR = (index, field, value) => {
    const updated = [...grItems];
    updated[index][field] = value;
    setGrItems(updated);
  };

  const pickGRFile = async (index) => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
    if (!result.canceled && result.assets && result.assets[0]) {
      updateGR(index, 'file', result.assets[0]);
    }
  };

  const updateForm = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
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
      case 'name_of_consignee':
        if (!value?.trim()) errorMsg = 'Consignee name is required';
        break;
      case 'name_of_consignor':
        if (!value?.trim()) errorMsg = 'Consignor name is required';
        break;
      case 'commodity':
        if (!value?.trim()) errorMsg = 'Commodity is required';
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

  const removeDoc = (index) => {
    setUploadedDocs((prev) => prev.filter((_, i) => i !== index));
  };

  const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const fullYear = d.getFullYear();
    return `${fullYear}-${month}-${day}`;
  };

  const openDatePicker = (type, index = null) => {
    setActiveDateField({ type, index });
    setShowDatePicker(true);
  };

  const handleDateChange = (event, selectedDate) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'dismissed') return;
      if (selectedDate && activeDateField) {
        applyDate(selectedDate);
      }
    } else {
      if (selectedDate) setTempDate(selectedDate);
    }
  };

  const applyDate = (date) => {
    const formattedDate = formatDate(date);
    if (activeDateField.type === 'invoice') {
      updateInvoice(activeDateField.index, 'invoice_date', formattedDate);
    } else if (activeDateField.type === 'gr') {
      updateGR(activeDateField.index, 'gr_date', formattedDate);
    }
  };

  const confirmIOSDate = () => {
    applyDate(tempDate);
    setShowDatePicker(false);
  };

  const cancelIOSDate = () => {
    setShowDatePicker(false);
  };

  const validateForm = () => {
    const required = [
      { key: 'contact_person_name', label: 'Contact Person Name' },
      { key: 'contact_person_mobile', label: 'Contact Person Mobile' },
      { key: 'case_reference', label: 'Claim Number' },
      { key: 'name_of_consignee', label: 'Consignee Name' },
      { key: 'name_of_consignor', label: 'Consignor Name' },
      { key: 'commodity', label: 'Commodity' },
    ];

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

      submitData.append('survey_type', 'marine_final');
      submitData.append('contact_person_name', formData.contact_person_name);
      submitData.append('contact_person_mobile', formData.contact_person_mobile);
      submitData.append('location_method', locationMethod);
      submitData.append('case_reference', formData.case_reference);
      submitData.append('is_emergency', isEmergency.toString());
      submitData.append('name_of_insured', formData.name_of_insured);
      submitData.append('policy_number', formData.policy_number);

      submitData.append('name_of_consignee', formData.name_of_consignee);
      submitData.append('name_of_consignor', formData.name_of_consignor);
      submitData.append('commodity', formData.commodity);

      // Optional fields
      if (formData.latitude) submitData.append('latitude', formData.latitude);
      if (formData.longitude) submitData.append('longitude', formData.longitude);
      if (formData.pincode) submitData.append('pincode', formData.pincode);
      if (formData.city) submitData.append('city', formData.city);
      if (formData.state) submitData.append('state', formData.state);
      if (formData.address) submitData.append('address', formData.address);
      if (locationMethod === 'google_maps_link' && formData.google_maps_link) submitData.append('google_maps_link', formData.google_maps_link.trim());
      if (formData.instructions) submitData.append('instructions', formData.instructions);

      // Invoices and GRs
      const validInvoices = invoices.filter(i => i.invoice_number);
      submitData.append('invoices', JSON.stringify(validInvoices));

      validInvoices.forEach(inv => {
        if (inv.file) {
          submitData.append('invoice_files', {
            uri: inv.file.uri,
            name: inv.file.name,
            type: inv.file.mimeType || 'application/pdf'
          });
        }
      });

      // GRs
      const validGRs = grItems.filter(g => g.gr_number);
      submitData.append('gr_entries', JSON.stringify(validGRs));

      validGRs.forEach(gr => {
        if (gr.file) {
          submitData.append('gr_files', {
            uri: gr.file.uri,
            name: gr.file.name,
            type: gr.file.mimeType || 'application/pdf'
          });
        }
      });

      // General Documents
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
        'Marine Survey created successfully!',
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

  const renderInput = (label, placeholder, key, keyboardType = 'default', required = false) => (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label} {required && <Text style={{ color: 'red' }}>*</Text>}</Text>
      <TextInput
        style={[styles.input, fieldErrors[key] ? styles.inputError : null]}
        placeholder={placeholder}
        placeholderTextColor="#999"
        value={formData[key]}
        onChangeText={(value) => updateForm(key, value)}
        onBlur={() => handleBlur(key)}
        keyboardType={keyboardType}
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
        <Text style={styles.headerTitle}>Marine Spot Survey</Text>
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
            {locationMethod === 'google_maps_link' && renderInput('Google Maps Link', 'https://maps.google.com/...', 'google_maps_link', 'url')}
            <Text style={{ fontSize: 11, color: '#999', marginTop: -8, marginBottom: 8 }}>Paste a maps link the surveyor can open for navigation.</Text>
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
            {renderInput('Name of Insured', 'Enter insured name', 'name_of_insured')}
            {renderInput('Policy Number', 'Enter policy number', 'policy_number')}
          </>
        )}

        {/* Consignee & Consignor Details */}
        {renderSection('local-shipping', 'Consignee & Consignor Details',
          <>
            {renderInput('Name of Consignee', 'Enter consignee name', 'name_of_consignee', 'default', true)}
            {renderInput('Name of Consignor', 'Enter consignor name', 'name_of_consignor', 'default', true)}
            {renderInput('Commodity', 'Enter commodity', 'commodity', 'default', true)}
          </>
        )}

        {/* Invoice Details */}
        {renderSection('receipt', 'Invoice Details',
          <>
            {invoices.map((invoice, index) => (
              <View key={index} style={styles.itemBlock}>
                <Text style={styles.itemTitle}>Invoice {index + 1}</Text>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Invoice Number</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="INV- 2025/001"
                    placeholderTextColor="#999"
                    value={invoice.invoice_number}
                    onChangeText={(v) => updateInvoice(index, 'invoice_number', v)}
                  />
                </View>
                <View style={styles.rowInputs}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Invoice Date</Text>
                    <TouchableOpacity style={styles.dateInput} onPress={() => openDatePicker('invoice', index)}>
                      <Text style={[styles.dateText, invoice.invoice_date && { color: '#333' }]}>{invoice.invoice_date || 'YYYY-MM-DD'}</Text>
                      <MaterialIcons name="calendar-today" size={20} color="#999" />
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Amount</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Amount"
                      placeholderTextColor="#999"
                      value={invoice.invoice_amount}
                      onChangeText={(v) => updateInvoice(index, 'invoice_amount', v)}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Upload Invoice (Optional)</Text>
                  <TouchableOpacity style={styles.uploadArea} onPress={() => pickInvoiceFile(index)}>
                    <MaterialIcons name={invoice.file ? "check-circle" : "file-upload"} size={20} color={invoice.file ? AppColors.primary : "#999"} />
                    <Text style={styles.uploadAreaText}>{invoice.file ? invoice.file.name : "Choose File"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.addMoreBtn} onPress={addInvoice}>
              <MaterialIcons name="add-circle-outline" size={20} color={AppColors.primary} />
              <Text style={styles.addMoreText}>Add More Invoice</Text>
            </TouchableOpacity>
          </>
        )}

        {/* GR (Goods Receipt) Details */}
        {renderSection('receipt-long', 'GR (Good Receipt) Details',
          <>
            {grItems.map((gr, index) => (
              <View key={index} style={styles.itemBlock}>
                <Text style={styles.itemTitle}>GR {index + 1}</Text>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>GR Number</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="GR- 4582/24"
                    placeholderTextColor="#999"
                    value={gr.gr_number}
                    onChangeText={(v) => updateGR(index, 'gr_number', v)}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>GR Date</Text>
                  <TouchableOpacity style={styles.dateInput} onPress={() => openDatePicker('gr', index)}>
                    <Text style={[styles.dateText, gr.gr_date && { color: '#333' }]}>{gr.gr_date || 'YYYY-MM-DD'}</Text>
                    <MaterialIcons name="calendar-today" size={20} color="#999" />
                  </TouchableOpacity>
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Upload GR (Optional)</Text>
                  <TouchableOpacity style={styles.uploadArea} onPress={() => pickGRFile(index)}>
                    <MaterialIcons name={gr.file ? "check-circle" : "file-upload"} size={20} color={gr.file ? AppColors.primary : "#999"} />
                    <Text style={styles.uploadAreaText}>{gr.file ? gr.file.name : "Choose File"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.addMoreBtn} onPress={addGR}>
              <MaterialIcons name="add-circle-outline" size={20} color={AppColors.primary} />
              <Text style={styles.addMoreText}>Add More GR</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Document Upload */}
        {renderSection('folder', 'Other Documents',
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
              surveyType="marine_final"
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

      {/* Date Picker - Android */}
      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          onChange={handleDateChange}
        />
      )}

      {/* Date Picker Modal - iOS */}
      {Platform.OS === 'ios' && (
        <Modal visible={showDatePicker} transparent animationType="slide">
          <View style={styles.dateModalOverlay}>
            <View style={styles.dateModalContent}>
              <View style={styles.dateModalHeader}>
                <TouchableOpacity onPress={cancelIOSDate}>
                  <Text style={styles.dateModalCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={confirmIOSDate}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
                style={{ height: 200 }}
              />
            </View>
          </View>
        </Modal>
      )}
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
  content: { flex: 1 },
  scrollContent: { padding: 16 },
  section: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  inputGroup: { marginBottom: 12 },
  inputLabel: { fontSize: 13, color: '#666', marginBottom: 6 },
  input: { backgroundColor: '#F8F8F8', borderRadius: 8, padding: 12, fontSize: 14, color: '#333', borderWidth: 1, borderColor: '#E8E8E8' },
  inputError: { borderColor: '#FF3B30', backgroundColor: '#FFF5F5' },
  errorText: { fontSize: 12, color: '#FF3B30', marginTop: 4 },
  textArea: { height: 80, textAlignVertical: 'top' },
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
  radioRow: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  radioOption: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#CCC', justifyContent: 'center', alignItems: 'center' },
  radioActive: { borderColor: AppColors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: AppColors.primary },
  radioLabel: { fontSize: 14, color: '#333' },
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
  pricingList: { gap: 8 },
  pricingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  pricingLabel: { fontSize: 14, color: '#666' },
  pricingValue: { fontSize: 14, fontWeight: '600', color: AppColors.primary },
  footer: { padding: 16, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#E8E8E8' },
  submitBtn: { backgroundColor: AppColors.primary, borderRadius: 24, padding: 16, alignItems: 'center' },
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  itemBlock: { marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  itemTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  rowInputs: { flexDirection: 'row', gap: 12 },
  dateInput: { backgroundColor: '#F8F8F8', borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E8E8E8' },
  dateText: { fontSize: 14, color: '#999' },
  addMoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, justifyContent: 'center' },
  addMoreText: { fontSize: 14, color: AppColors.primary, fontWeight: '500' },
  dateModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  dateModalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 20 },
  dateModalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E8E8E8' },
  dateModalCancel: { fontSize: 16, color: '#999' },
  dateModalDone: { fontSize: 16, color: AppColors.primary, fontWeight: '600' },
});
