import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors } from '../../constants/theme';

export default function WelcomeOnboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [agreed, setAgreed] = useState(false);

  const handleSetMpin = () => {
    if (agreed) {
      router.push('/set-mpin');
    }
  };

  return (
    <LinearGradient
      colors={['#E8DFF5', '#F5EFE6', '#E8DFF5']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      {/* Content */}
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>We welcome you onboard</Text>
          
          <TouchableOpacity 
            style={styles.checkboxRow} 
            onPress={() => setAgreed(!agreed)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed && <MaterialIcons name="check" size={16} color="#FFF" />}
            </View>
            <Text style={styles.agreementText}>
              I agree with the{' '}
              <Text style={styles.linkText}>Service Level Agreement (SLA)</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 16, 24) }]}>
        <TouchableOpacity
          style={[styles.setMpinBtn, !agreed && styles.setMpinBtnDisabled]}
          onPress={handleSetMpin}
          disabled={!agreed}
        >
          <Text style={styles.setMpinBtnText}>Set MPIN</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 32,
    paddingTop: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 20,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: AppColors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: AppColors.primary,
  },
  agreementText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    lineHeight: 22,
  },
  linkText: {
    color: AppColors.primary,
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  setMpinBtn: {
    backgroundColor: AppColors.primary,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
  },
  setMpinBtnDisabled: {
    backgroundColor: '#B8A8D8',
  },
  setMpinBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
