import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors } from '../constants/theme';

const ROLES = [
  {
    id: 'surveyor',
    title: 'Surveyor',
    description: 'Conduct surveys and inspections on-site',
    icon: 'assignment-ind',
  },
  {
    id: 'assigner',
    title: 'Assigner',
    description: 'Assign and manage survey requests',
    icon: 'assignment',
  },
];

export default function RoleSelectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedRole, setSelectedRole] = useState(null);

  const handleContinue = () => {
    if (selectedRole === 'surveyor') {
      router.push('/surveyor-profile');
    } else if (selectedRole === 'assigner') {
      router.push('/set-mpin');
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[AppColors.gradientEnd, AppColors.primary]}
        style={styles.headerGradient}
      >
        <Text style={styles.headerTitle}>Choose Your Role</Text>
        <Text style={styles.headerSubtitle}>Select how you want to use the app</Text>
      </LinearGradient>

      <View style={styles.content}>
        <View style={styles.rolesContainer}>
          {ROLES.map((role) => (
            <TouchableOpacity
              key={role.id}
              style={[
                styles.roleCard,
                selectedRole === role.id && styles.roleCardSelected,
              ]}
              onPress={() => setSelectedRole(role.id)}
              activeOpacity={0.7}
            >
              <View style={[
                styles.iconContainer,
                selectedRole === role.id && styles.iconContainerSelected,
              ]}>
                <MaterialIcons
                  name={role.icon}
                  size={40}
                  color={selectedRole === role.id ? '#FFF' : AppColors.primary}
                />
              </View>
              <Text style={[
                styles.roleTitle,
                selectedRole === role.id && styles.roleTitleSelected,
              ]}>
                {role.title}
              </Text>
              <Text style={styles.roleDescription}>{role.description}</Text>
              {selectedRole === role.id && (
                <View style={styles.checkmark}>
                  <MaterialIcons name="check-circle" size={24} color={AppColors.primary} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[
            styles.continueBtn,
            !selectedRole && styles.continueBtnDisabled,
            { marginBottom: Math.max(insets.bottom, 12) },
          ]}
          onPress={handleContinue}
          disabled={!selectedRole}
        >
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  headerGradient: {
    paddingTop: 80,
    paddingHorizontal: 24,
    paddingBottom: 40,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFF',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginTop: 8,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'space-between',
  },
  rolesContainer: {
    gap: 16,
    marginTop: 20,
  },
  roleCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    position: 'relative',
  },
  roleCardSelected: {
    borderColor: AppColors.primary,
    backgroundColor: '#F8F6FF',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F0EEFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconContainerSelected: {
    backgroundColor: AppColors.primary,
  },
  roleTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  roleTitleSelected: {
    color: AppColors.primary,
  },
  roleDescription: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  checkmark: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  continueBtn: {
    backgroundColor: AppColors.primary,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  continueBtnDisabled: {
    backgroundColor: '#CCC',
  },
  continueBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
