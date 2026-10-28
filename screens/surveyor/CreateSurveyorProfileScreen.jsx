import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors } from '../../constants/theme';
import api from '../../lib/api';

const KYC_DOCUMENTS = [
  {
    id: 'government_id',
    title: 'Government-Issued ID',
    subtitle: 'Aadhar, Driver\'s License, etc.',
    icon: 'badge',
  },
  {
    id: 'proof_of_address',
    title: 'Proof of Address',
    subtitle: 'e.g. Utility Bill',
    icon: 'home',
  },
  {
    id: 'surveyor_license',
    title: 'Surveyor\'s License',
    subtitle: 'A copy of your certificate',
    icon: 'verified',
    optional: true,
  },
];

export default function CreateSurveyorProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [profileImage, setProfileImage] = useState(null); // Stores full asset object or uri
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    business_address: '',
    city: '',
    state: '',
    pincode: '',
    surveyor_license_id: '',
  });

  const [step, setStep] = useState(1); // 1: Phone, 2: OTP, 3: Form
  const [verificationToken, setVerificationToken] = useState(null);
  const [otp, setOtp] = useState('');
  const [pincodeLoading, setPincodeLoading] = useState(false);

  // Store full asset objects for documents
  const [uploadedDocs, setUploadedDocs] = useState({});

  const updateForm = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  // Fetch city and state from pincode using India Post API
  const fetchPincodeData = async (pincode) => {
    if (!pincode || pincode.length !== 6) return;

    setPincodeLoading(true);
    try {
      const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
      const data = await response.json();

      if (data?.[0]?.Status === 'Success' && data[0].PostOffice?.length > 0) {
        const postOffice = data[0].PostOffice[0];
        setFormData(prev => ({
          ...prev,
          city: postOffice.District || postOffice.Block || '',
          state: postOffice.State || ''
        }));
      }
    } catch (err) {
      console.log('Pincode lookup failed:', err.message);
      // Silently fail - user can still enter manually
    } finally {
      setPincodeLoading(false);
    }
  };

  const handlePincodeChange = (value) => {
    const pincode = value.replace(/\D/g, '');
    updateForm('pincode', pincode);
    if (pincode.length === 6) {
      fetchPincodeData(pincode);
    }
  };

  const handleSendOtp = async () => {
    if (!formData.phone || formData.phone.length !== 10) {
      Alert.alert('Validation Error', 'Please enter a valid 10-digit phone number');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/send-otp', {
        phone: formData.phone,
        purpose: 'registration'
      });

      Alert.alert('Success', 'OTP sent to your phone number');
      setStep(2);
    } catch (error) {
      console.error('Send OTP error:', error);
      Alert.alert('Error', error.response?.data?.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 4) {
      Alert.alert('Validation Error', 'Please enter the valid OTP');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/verify-otp', {
        phone: formData.phone,
        otp: otp,
        purpose: 'registration'
      });

      if (response.success) {
        setVerificationToken(response.data.verification_token);
        setStep(3);
        Alert.alert('Success', 'Phone verified successfully');
      }
    } catch (error) {
      console.error('Verify OTP error:', error);
      Alert.alert('Error', error.response?.data?.message || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  const pickProfileImage = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please allow access to your camera to take a profile photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setProfileImage(result.assets[0]);
    }
  };

  const uploadDocument = async (docId) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        setUploadedDocs((prev) => ({
          ...prev,
          [docId]: result.assets[0],
        }));
      }
    } catch (err) {
      console.log('Document picker error:', err);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const validateForm = () => {
    if (!formData.full_name.trim()) return 'Full Name is required';
    if (!formData.email.trim()) return 'Email is required';
    if (!formData.phone.trim() || formData.phone.length !== 10) return 'Valid 10-digit Phone is required';
    if (!formData.password || formData.password.length !== 4 || !/^\d{4}$/.test(formData.password)) return 'PIN must be exactly 4 digits';
    if (!verificationToken) return 'Phone verification is required';
    return null;
  };

  const handleSubmit = async () => {
    const error = validateForm();
    if (error) {
      Alert.alert('Validation Error', error);
      return;
    }

    setLoading(true);
    try {
      const data = new FormData();

      // Add verification token
      data.append('verification_token', verificationToken);

      // Append text fields
      Object.keys(formData).forEach(key => {
        if (formData[key]) {
          data.append(key, formData[key]);
        }
      });

      // Append profile picture
      if (profileImage) {
        const uriParts = profileImage.uri.split('.');
        const fileType = uriParts[uriParts.length - 1];

        data.append('profile_picture', {
          uri: profileImage.uri,
          name: `profile.${fileType}`,
          type: `image/${fileType}`,
        });
      }

      // Append documents
      Object.keys(uploadedDocs).forEach(key => {
        const doc = uploadedDocs[key];
        if (doc) {
          data.append(key, {
            uri: doc.uri,
            name: doc.name || `document.${doc.mimeType ? doc.mimeType.split('/')[1] : 'pdf'}`,
            type: doc.mimeType || 'application/pdf', // Default fallback
          });
        }
      });

      console.log('Submitting registration...', Object.keys(formData));

      const response = await api.upload('/auth/surveyor/register', data);

      if (response.success) {
        router.push('/submission-status');
      } else {
        throw new Error(response.message || 'Registration failed');
      }
    } catch (error) {
      console.error('Registration Error:', error);

      const baseMessage = 'We are unable to register you as you might have missed some essential data to be filled. Please review every required field and try again.';
      let errorMessage = baseMessage;

      if (error.data && error.data.errors) {
        const serverErrors = error.data.errors.map(e => e.msg).filter(Boolean).join('\n');
        if (serverErrors) errorMessage += `\n\nMissing or invalid:\n${serverErrors}`;
      } else if (error.response?.data?.message) {
        errorMessage += `\n\n${error.response.data.message}`;
      } else if (error.message && error.message !== 'Registration failed') {
        errorMessage += `\n\n${error.message}`;
      }

      Alert.alert('Registration Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create your Surveyor Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {step === 1 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="phone-iphone" size={22} color="#333" />
                <View>
                  <Text style={styles.sectionTitle}>Phone Verification</Text>
                  <Text style={styles.sectionSubtitle}>We need to verify your phone number to proceed.</Text>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Mobile Number <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter 10-digit mobile number"
                  placeholderTextColor="#999"
                  value={formData.phone}
                  onChangeText={(v) => updateForm('phone', v)}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleSendOtp}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.submitBtnText}>Send Verification Code</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {step === 2 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="security" size={22} color="#333" />
                <View>
                  <Text style={styles.sectionTitle}>Enter Verification Code</Text>
                  <Text style={styles.sectionSubtitle}>Enter the 6-digit code sent to +91 {formData.phone}</Text>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>OTP Code <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={[styles.input, { letterSpacing: 8, textAlign: 'center', fontSize: 20, fontWeight: 'bold' }]}
                  placeholder="XXXXXX"
                  placeholderTextColor="#DDD"
                  value={otp}
                  onChangeText={setOtp}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </View>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleVerifyOtp}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.submitBtnText}>Verify OTP</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={{ marginTop: 20, alignItems: 'center' }}
                onPress={() => setStep(1)}
              >
                <Text style={{ color: AppColors.primary }}>Change Phone Number</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 3 && (
            <>
              {/* Profile Picture Section */}
              <LinearGradient
                colors={['#E8DFF5', '#F5EFE6']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.profileSection}
              >
                <TouchableOpacity style={styles.profileImageContainer} onPress={pickProfileImage}>
                  {profileImage ? (
                    <Image source={{ uri: profileImage.uri }} style={styles.profileImage} />
                  ) : (
                    <View style={styles.profilePlaceholder}>
                      <MaterialIcons name="person" size={50} color="#B8A8D8" />
                    </View>
                  )}
                  <View style={styles.editBadge}>
                    <MaterialIcons name="edit" size={14} color="#FFF" />
                  </View>
                </TouchableOpacity>
                <Text style={styles.uploadTitle}>Upload Profile Picture</Text>
                <Text style={styles.uploadSubtitle}>A professional headshot is required.</Text>
              </LinearGradient>

              {/* Account Details */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="lock-outline" size={22} color="#333" />
                  <Text style={styles.sectionTitle}>Account Credentials</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Phone Number <MaterialIcons name="check-circle" size={12} color="green" /></Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: '#EFEFEF', color: '#666' }]}
                    value={formData.phone}
                    editable={false}
                  />
                  <Text style={{ fontSize: 11, color: 'green', marginTop: 4 }}>✓ Verified</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>4-Digit PIN <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter 4-digit PIN"
                    placeholderTextColor="#999"
                    value={formData.password}
                    onChangeText={(v) => updateForm('password', v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    maxLength={4}
                    secureTextEntry
                  />
                </View>
              </View>

              {/* Personal Details */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="person-outline" size={22} color="#333" />
                  <Text style={styles.sectionTitle}>Personal Details</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Full Name <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter full name"
                    placeholderTextColor="#999"
                    value={formData.full_name}
                    onChangeText={(v) => updateForm('full_name', v)}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Email Address <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter email address"
                    placeholderTextColor="#999"
                    value={formData.email}
                    onChangeText={(v) => updateForm('email', v)}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.row}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Pincode</Text>
                    <View style={{ position: 'relative' }}>
                      <TextInput
                        style={styles.input}
                        placeholder="Enter 6-digit pincode"
                        placeholderTextColor="#999"
                        value={formData.pincode}
                        onChangeText={handlePincodeChange}
                        keyboardType="number-pad"
                        maxLength={6}
                      />
                      {pincodeLoading && (
                        <View style={{ position: 'absolute', right: 12, top: 14 }}>
                          <ActivityIndicator size="small" color={AppColors.primary} />
                        </View>
                      )}
                    </View>
                    {formData.pincode.length === 6 && formData.city ? (
                      <Text style={{ fontSize: 11, color: 'green', marginTop: 4 }}>
                        ✓ {formData.city}, {formData.state}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.row}>
                  <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                    <Text style={styles.inputLabel}>City</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="City"
                      placeholderTextColor="#999"
                      value={formData.city}
                      onChangeText={(v) => updateForm('city', v)}
                    />
                  </View>
                  <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                    <Text style={styles.inputLabel}>State</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="State"
                      placeholderTextColor="#999"
                      value={formData.state}
                      onChangeText={(v) => updateForm('state', v)}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Business/Operating Address</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Enter your business/operating address..."
                    placeholderTextColor="#999"
                    value={formData.business_address}
                    onChangeText={(v) => updateForm('business_address', v)}
                    multiline
                    numberOfLines={2}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Surveyor License ID (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter license ID"
                    placeholderTextColor="#999"
                    value={formData.surveyor_license_id}
                    onChangeText={(v) => updateForm('surveyor_license_id', v)}
                  />
                </View>
              </View>

              {/* Document Verification (KYC) */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="folder-open" size={22} color="#333" />
                  <View>
                    <Text style={styles.sectionTitle}>Document Verification (KYC)</Text>
                    <Text style={styles.sectionSubtitle}>Please upload clear copies for verification.</Text>
                  </View>
                </View>

                {KYC_DOCUMENTS.map((doc) => (
                  <View key={doc.id} style={styles.docRow}>
                    <View style={styles.docIconContainer}>
                      <MaterialIcons name={doc.icon} size={24} color={AppColors.primary} />
                    </View>
                    <View style={styles.docInfo}>
                      <Text style={styles.docTitle}>
                        {doc.title}
                        {doc.optional && <Text style={styles.optionalText}> (optional)</Text>}
                      </Text>
                      <Text style={styles.docSubtitle}>{doc.subtitle}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.uploadBtn, uploadedDocs[doc.id] && styles.uploadBtnDone]}
                      onPress={() => uploadDocument(doc.id)}
                    >
                      <Text style={styles.uploadBtnText}>
                        {uploadedDocs[doc.id] ? 'Done' : 'Upload'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>


            </>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Submit Button */}
      {step === 3 && (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitBtnText}>Submit for Approval</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
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
  profileSection: {
    alignItems: 'center',
    paddingVertical: 30,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
  },
  profileImageContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#FFF',
  },
  profilePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#E8E0F0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFF',
  },
  editBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: AppColors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  uploadTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  uploadSubtitle: {
    fontSize: 13,
    color: '#666',
  },
  section: {
    backgroundColor: '#FFF',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  inputGroup: { marginBottom: 16 },
  row: { flexDirection: 'row', marginBottom: 16 },
  inputLabel: { fontSize: 13, color: '#333', fontWeight: '500', marginBottom: 8 },
  required: { color: 'red' },
  input: {
    backgroundColor: '#F8F8F8',
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
    color: '#333',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  textArea: { height: 70, textAlignVertical: 'top' },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  docIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0EEFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  docInfo: { flex: 1 },
  docTitle: { fontSize: 14, fontWeight: '600', color: '#333' },
  optionalText: { fontWeight: '400', color: '#999' },
  docSubtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  uploadBtn: {
    backgroundColor: '#F0EEFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  uploadBtnDone: {
    backgroundColor: '#E8F8E8',
  },
  uploadBtnText: {
    fontSize: 13,
    color: AppColors.primary,
    fontWeight: '500',
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
  },
  submitBtn: {
    backgroundColor: AppColors.primary,
    borderRadius: 30,
    padding: 16,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
