import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '../constants/theme';
import { useAuth } from '../app/_layout';
import { useTabBarClearance } from '../components/CustomTabBar';
import { getAssignerProfile } from '../lib/assignerService';
import api from '../lib/api';
import { getMediaUrl } from '../constants/config';

export default function ProfileScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const tabBarClearance = useTabBarClearance();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const data = await getAssignerProfile();
      setProfile(data);
    } catch (error) {
      console.error('Profile fetch error:', error);
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
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              try {
                await api.post('/auth/assigner/logout', {});
              } catch (e) {
                // Ignore API errors
              }
              await signOut();
            } catch (error) {
              console.error('Logout error:', error);
              setLoggingOut(false);
              Alert.alert('Error', 'Failed to logout. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleMenuPress = (route) => {
    if (route === 'edit-profile') {
      router.push('/edit-profile');
    } else if (route === 'change-password') {
      router.push('/change-password');
    } else if (route === 'terms') {
      router.push('/terms');
    } else if (route === 'privacy') {
      router.push('/privacy');
    } else if (route === 'ledger') {
      router.push('/ledger');
    } else {
      console.log('Menu pressed:', route);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone. All your data will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setDeletePassword('');
            setShowDeleteModal(true);
          },
        },
      ]
    );
  };

  const confirmDeleteAccount = async () => {
    if (!deletePassword.trim() || deletePassword.length !== 4) {
      Alert.alert('Error', 'Please enter your 4-digit PIN to confirm.');
      return;
    }

    setDeleting(true);
    try {
      await api.post('/auth/assigner/delete-account', { password: deletePassword });
      setShowDeleteModal(false);
      Alert.alert(
        'Account Deleted',
        'Your account has been successfully deleted.',
        [{ text: 'OK', onPress: () => signOut() }]
      );
    } catch (error) {
      console.error('Delete account error:', error);
      const msg = error.message || 'Failed to delete account. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setDeleting(false);
    }
  };

  if (loading || loggingOut) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={AppColors.primary} />
        {loggingOut && <Text style={{ marginTop: 16, color: '#666' }}>Logging out...</Text>}
      </View>
    );
  }

  const formatPhone = (phone) => {
    if (!phone) return '';
    return `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Text style={styles.headerTitle}>Profile & Settings</Text>

        {/* Profile Section */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
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
          </View>
          <Text style={styles.profileName}>
            {profile?.company_name || profile?.contact_person_name || 'User'}
          </Text>
          <Text style={styles.profilePhone}>{formatPhone(profile?.phone)}</Text>
        </View>

        {/* Account Details Section */}
        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.menuCard}>

          <TouchableOpacity style={styles.menuItem} onPress={() => handleMenuPress('edit-profile')}>
            <View style={[styles.iconContainer, { backgroundColor: '#EEF0FF' }]}>
              <MaterialIcons name="person-outline" size={22} color="#5B67CA" />
            </View>
            <Text style={styles.menuItemText}>Edit Profile</Text>
            <MaterialIcons name="chevron-right" size={24} color="#CCC" />
          </TouchableOpacity>
        </View>

        {/* Payments Section */}
        <Text style={styles.sectionTitle}>Payments</Text>
        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuItem} onPress={() => handleMenuPress('ledger')}>
            <View style={[styles.iconContainer, { backgroundColor: '#E8F5E9' }]}>
              <MaterialIcons name="receipt-long" size={22} color="#4CAF50" />
            </View>
            <Text style={styles.menuItemText}>Survey Payment Ledger</Text>
            <MaterialIcons name="chevron-right" size={24} color="#CCC" />
          </TouchableOpacity>
        </View>

        {/* Security Section */}
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuItem} onPress={() => handleMenuPress('change-password')}>
            <View style={[styles.iconContainer, { backgroundColor: '#FFF5E5' }]}>
              <MaterialIcons name="lock-outline" size={22} color="#FFA726" />
            </View>
            <Text style={styles.menuItemText}>Change Password</Text>
            <MaterialIcons name="chevron-right" size={24} color="#CCC" />
          </TouchableOpacity>
        </View>

        {/* Support Section */}
        <Text style={styles.sectionTitle}>Legal</Text>
        <View style={styles.menuCard}>
          <TouchableOpacity style={[styles.menuItem, styles.menuItemBorder]} onPress={() => handleMenuPress('terms')}>
            <View style={[styles.iconContainer, { backgroundColor: '#E3F2FD' }]}>
              <MaterialIcons name="description" size={22} color="#2196F3" />
            </View>
            <Text style={styles.menuItemText}>Terms & Conditions</Text>
            <MaterialIcons name="chevron-right" size={24} color="#CCC" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => handleMenuPress('privacy')}>
            <View style={[styles.iconContainer, { backgroundColor: '#FCE4EC' }]}>
              <MaterialIcons name="privacy-tip" size={22} color="#E91E63" />
            </View>
            <Text style={styles.menuItemText}>Privacy Policy</Text>
            <MaterialIcons name="chevron-right" size={24} color="#CCC" />
          </TouchableOpacity>
        </View>

        {/* Logout */}
        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <View style={[styles.iconContainer, { backgroundColor: '#FFEBEE' }]}>
              <MaterialIcons name="logout" size={22} color="#F44336" />
            </View>
            <Text style={[styles.menuItemText, { color: '#F44336' }]}>Logout</Text>
            <MaterialIcons name="chevron-right" size={24} color="#CCC" />
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>Version 1.0.0</Text>
        <TouchableOpacity onPress={handleDeleteAccount} style={styles.deleteLink}>
          <Text style={styles.deleteLinkText}>Delete Your Account</Text>
        </TouchableOpacity>
        <View style={{ height: tabBarClearance }} />
      </ScrollView>

      {/* Delete Account Password Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setShowDeleteModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalIconContainer}>
              <MaterialIcons name="warning" size={40} color="#F44336" />
            </View>
            <Text style={styles.modalTitle}>Confirm Account Deletion</Text>
            <Text style={styles.modalSubtitle}>
              Enter your 4-digit PIN to permanently delete your account. This action cannot be reversed.
            </Text>
            <TextInput
              style={[styles.modalInput, { textAlign: 'center', fontSize: 24, letterSpacing: 12 }]}
              placeholder="••••"
              placeholderTextColor="#999"
              secureTextEntry
              keyboardType="number-pad"
              maxLength={4}
              value={deletePassword}
              onChangeText={(text) => setDeletePassword(text.replace(/[^0-9]/g, '').slice(0, 4))}
              editable={!deleting}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalDeleteButton]}
                onPress={confirmDeleteAccount}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalDeleteText}>Delete Account</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1A1A1A',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: '#FFF',
    marginHorizontal: 16,
    borderRadius: 16,
    marginBottom: 24,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#E0E0E0',
  },
  profileName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  profilePhone: {
    fontSize: 15,
    color: '#666',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#999',
    marginLeft: 20,
    marginBottom: 8,
    marginTop: 8,
  },
  menuCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  verifiedBadge: {
    fontSize: 13,
    color: '#4CAF50',
    fontWeight: '600',
    marginRight: 8,
  },
  version: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
    marginTop: 20,
  },
  deleteLink: {
    alignSelf: 'center',
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  deleteLinkText: {
    fontSize: 13,
    color: '#BDBDBD',
    textDecorationLine: 'underline',
  },
  initialsAvatar: {
    backgroundColor: '#EEF0FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  initialsText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#5B67CA',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalIconContainer: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#FFEBEE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  modalInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1A1A1A',
    marginBottom: 20,
    backgroundColor: '#FAFAFA',
  },
  modalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelButton: {
    backgroundColor: '#F5F5F5',
  },
  modalDeleteButton: {
    backgroundColor: '#F44336',
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  modalDeleteText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
});
