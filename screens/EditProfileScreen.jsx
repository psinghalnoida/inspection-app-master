import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '../constants/theme';
import { getAssignerProfile } from '../lib/assignerService';
import api from '../lib/api';
import { getMediaUrl } from '../constants/config';

export default function EditProfileScreen() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profilePicUrl, setProfilePicUrl] = useState('');
    const [newPhoto, setNewPhoto] = useState(null);
    const [profile, setProfile] = useState({
        email: '',
        phone: '',
        company_name: '',
        contact_person_name: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
    });

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            const data = await getAssignerProfile();
            setProfile({
                email: data.email || '',
                phone: data.phone || '',
                company_name: data.company_name || '',
                contact_person_name: data.contact_person_name || '',
                address: data.address || '',
                city: data.city || '',
                state: data.state || '',
                pincode: data.pincode || '',
            });
            setProfilePicUrl(data.profile_picture_url || '');
        } catch (error) {
            console.error('Profile fetch error:', error);
            Alert.alert('Error', 'Failed to load profile');
        } finally {
            setLoading(false);
        }
    };

    // Current avatar to show: the freshly picked image, else the saved photo
    // (resolved to a full URL), else null so we render the company initial.
    const getAvatarUri = () => {
        if (newPhoto) return newPhoto.uri;
        if (profilePicUrl) return getMediaUrl(profilePicUrl);
        return null;
    };

    const choosePhotoSource = () => {
        Alert.alert('Profile Photo', 'Choose a photo source', [
            { text: 'Camera', onPress: () => pickPhoto('camera') },
            { text: 'Gallery', onPress: () => pickPhoto('library') },
            { text: 'Cancel', style: 'cancel' },
        ]);
    };

    const pickPhoto = async (source) => {
        try {
            // Gallery uses the Android system photo picker (no media permissions
            // required); only the camera path needs a runtime permission.
            if (source === 'camera') {
                const perm = await ImagePicker.requestCameraPermissionsAsync();
                if (!perm.granted) {
                    Alert.alert('Permission Required', 'Please allow access to your camera to update your profile picture.');
                    return;
                }
            }
            const options = { allowsEditing: true, aspect: [1, 1], quality: 0.8 };
            const result = source === 'camera'
                ? await ImagePicker.launchCameraAsync(options)
                : await ImagePicker.launchImageLibraryAsync(options);
            if (!result.canceled && result.assets?.[0]) {
                setNewPhoto(result.assets[0]);
            }
        } catch (err) {
            console.error('Image pick error:', err);
            Alert.alert('Error', 'Failed to pick image');
        }
    };

    const handleSave = async () => {
        if (!profile.company_name.trim()) {
            Alert.alert('Error', 'Company name is required');
            return;
        }

        setSaving(true);
        try {
            if (newPhoto) {
                // Multipart so the new profile picture uploads alongside text fields
                const formData = new FormData();
                formData.append('company_name', profile.company_name);
                formData.append('contact_person_name', profile.contact_person_name || '');
                formData.append('address', profile.address || '');
                formData.append('city', profile.city || '');
                formData.append('state', profile.state || '');
                formData.append('pincode', profile.pincode || '');

                const uriParts = newPhoto.uri.split('.');
                const fileType = uriParts[uriParts.length - 1] || 'jpg';
                formData.append('profile_picture', {
                    uri: newPhoto.uri,
                    name: `profile.${fileType}`,
                    type: `image/${fileType}`,
                });

                await api.upload('/assigner/profile', formData, false, 'PUT');
            } else {
                await api.put('/assigner/profile', profile);
            }
            Alert.alert('Success', 'Profile updated successfully', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } catch (error) {
            console.error('Profile update error:', error);
            Alert.alert('Error', error.message || 'Failed to update profile');
        } finally {
            setSaving(false);
        }
    };

    const updateField = (field, value) => {
        setProfile(prev => ({ ...prev, [field]: value }));
    };

    if (loading) {
        return (
            <View style={[styles.container, styles.centered]}>
                <ActivityIndicator size="large" color={AppColors.primary} />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                        <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Edit Profile</Text>
                    <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.saveBtn}>
                        {saving ? (
                            <ActivityIndicator size="small" color={AppColors.primary} />
                        ) : (
                            <Text style={styles.saveText}>Save</Text>
                        )}
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                    {/* Profile Photo */}
                    <View style={styles.avatarSection}>
                        <TouchableOpacity onPress={choosePhotoSource} activeOpacity={0.8} style={styles.avatarWrap}>
                            {getAvatarUri() ? (
                                <Image source={{ uri: getAvatarUri() }} style={styles.avatar} />
                            ) : (
                                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                                    <Text style={styles.avatarInitial}>
                                        {(profile.company_name?.[0] || profile.contact_person_name?.[0] || 'C').toUpperCase()}
                                    </Text>
                                </View>
                            )}
                            <View style={styles.cameraBadge}>
                                <MaterialIcons name="photo-camera" size={16} color="#FFF" />
                            </View>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={choosePhotoSource}>
                            <Text style={styles.changePhotoText}>Change Photo</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Company Information */}
                    <Text style={styles.sectionTitle}>Company Information</Text>
                    <View style={styles.card}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Company Name *</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="Enter company name"
                                placeholderTextColor="#999"
                                value={profile.company_name}
                                onChangeText={(v) => updateField('company_name', v)}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Contact Person Name</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="Enter contact person name"
                                placeholderTextColor="#999"
                                value={profile.contact_person_name}
                                onChangeText={(v) => updateField('contact_person_name', v)}
                            />
                        </View>
                    </View>

                    {/* Contact Information (Read-only) */}
                    <Text style={styles.sectionTitle}>Contact Information</Text>
                    <View style={styles.card}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Email Address</Text>
                            <View style={styles.readOnlyField}>
                                <MaterialIcons name="email" size={18} color="#999" />
                                <Text style={styles.readOnlyText}>{profile.email}</Text>
                            </View>
                        </View>

                        <View style={[styles.inputGroup, { marginBottom: 0 }]}>
                            <Text style={styles.label}>Phone Number</Text>
                            <View style={styles.readOnlyField}>
                                <MaterialIcons name="phone" size={18} color="#999" />
                                <Text style={styles.readOnlyText}>+91 {profile.phone}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Address Information */}
                    <Text style={styles.sectionTitle}>Address Information</Text>
                    <View style={styles.card}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Address</Text>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                placeholder="Enter address"
                                placeholderTextColor="#999"
                                value={profile.address}
                                onChangeText={(v) => updateField('address', v)}
                                multiline
                                numberOfLines={3}
                            />
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, { flex: 1 }]}>
                                <Text style={styles.label}>City</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="City"
                                    placeholderTextColor="#999"
                                    value={profile.city}
                                    onChangeText={(v) => updateField('city', v)}
                                />
                            </View>
                            <View style={{ width: 12 }} />
                            <View style={[styles.inputGroup, { flex: 1 }]}>
                                <Text style={styles.label}>State</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="State"
                                    placeholderTextColor="#999"
                                    value={profile.state}
                                    onChangeText={(v) => updateField('state', v)}
                                />
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Pincode</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="Enter pincode"
                                placeholderTextColor="#999"
                                value={profile.pincode}
                                onChangeText={(v) => updateField('pincode', v)}
                                keyboardType="number-pad"
                                maxLength={6}
                            />
                        </View>
                    </View>

                    <View style={{ height: 100 }} />
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FAFAFA',
    },
    centered: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
        backgroundColor: '#FFF',
    },
    backBtn: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    saveBtn: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    saveText: {
        fontSize: 16,
        fontWeight: '600',
        color: AppColors.primary,
    },
    content: {
        flex: 1,
        paddingHorizontal: 16,
    },
    avatarSection: {
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 4,
    },
    avatarWrap: {
        position: 'relative',
    },
    avatar: {
        width: 96,
        height: 96,
        borderRadius: 48,
        backgroundColor: '#EEE',
    },
    avatarPlaceholder: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: AppColors.primary,
    },
    avatarInitial: {
        fontSize: 36,
        fontWeight: '700',
        color: '#FFF',
    },
    cameraBadge: {
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: AppColors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    changePhotoText: {
        marginTop: 8,
        fontSize: 14,
        fontWeight: '600',
        color: AppColors.primary,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: '#999',
        marginTop: 20,
        marginBottom: 8,
        marginLeft: 4,
    },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
    },
    inputGroup: {
        marginBottom: 16,
    },
    label: {
        fontSize: 13,
        fontWeight: '500',
        color: '#666',
        marginBottom: 8,
    },
    input: {
        backgroundColor: '#F8F8F8',
        borderRadius: 12,
        padding: 14,
        fontSize: 15,
        color: '#1A1A1A',
        borderWidth: 1,
        borderColor: '#E8E8E8',
    },
    textArea: {
        height: 80,
        textAlignVertical: 'top',
    },
    row: {
        flexDirection: 'row',
    },
    readOnlyField: {
        backgroundColor: '#F0F0F0',
        borderRadius: 12,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    readOnlyText: {
        fontSize: 15,
        color: '#666',
    },
});
