import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../app/_layout';
import { AppColors } from '../constants/theme';
import api from '../lib/api';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginType, setLoginType] = useState('assigner'); // 'assigner' or 'surveyor'

  const getErrorMessage = (error) => {
    if (!error) return 'Something went wrong. Please try again.';
    const msg = error.message || '';
    if (msg.includes('Network') || msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
      return 'No internet connection. Please check your network and try again.';
    }
    if (msg.toLowerCase().includes('invalid credentials') || msg.toLowerCase().includes('invalid credential')) {
      return 'Incorrect phone number or PIN. Please try again.';
    }
    if (msg.toLowerCase().includes('not activated') || msg.toLowerCase().includes('not active')) {
      return 'Your account is not activated yet. Please contact admin.';
    }
    if (msg.toLowerCase().includes('not found')) {
      return 'No account found with this phone number.';
    }
    return msg || 'Login failed. Please try again.';
  };

  const handleLogin = async () => {
    if (!phone || phone.length !== 10) {
      Alert.alert('Error', 'Please enter a valid 10-digit phone number');
      return;
    }
    if (!password || password.length !== 4) {
      Alert.alert('Error', 'Please enter your 4-digit PIN');
      return;
    }

    setLoading(true);
    try {
      let response;
      if (loginType === 'assigner') {
        response = await api.post('/auth/assigner/login', { phone, password });
      } else {
        response = await api.post('/auth/surveyor/login', { phone, password });
      }

      if (response.success && response.data) {
        const { user, tokens } = response.data;
        console.log(`✅ ${loginType} logged in:`, user.company_name || user.full_name);
        await signIn(tokens, user, loginType);
      } else {
        throw new Error(response.message || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error.message);
      Alert.alert('Login Failed', getErrorMessage(error));
      setLoading(false);
    }
  };

  const handleOTPLogin = () => {
    if (!phone) {
      Alert.alert('Error', 'Please enter phone number');
      return;
    }
    // Navigate to OTP verification screen
    router.push({
      pathname: '/verification',
      params: { phoneNumber: phone, loginType },
    });
  };

  return (
    <LinearGradient
      colors={[AppColors.gradientStart, AppColors.gradientEnd]}
      style={styles.container}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        {/* Logo Section */}
        <View style={styles.logoContainer}>
          <Image
            source={require('../assets/images/cm-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.brandName}>Claims Mitra</Text>
        </View>

        {/* Login Card */}
        <View style={styles.card}>
          <Text style={styles.title}>Login</Text>
          <Text style={styles.subtitle}>Enter your credentials to continue</Text>

          {/* Login Type Toggle */}
          <View style={styles.toggleContainer}>
            <TouchableOpacity
              style={[styles.toggleBtn, loginType === 'assigner' && styles.toggleBtnActive]}
              onPress={() => setLoginType('assigner')}
            >
              <Text style={[styles.toggleText, loginType === 'assigner' && styles.toggleTextActive]}>Assigner</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, loginType === 'surveyor' && styles.toggleBtnActive]}
              onPress={() => setLoginType('surveyor')}
            >
              <Text style={[styles.toggleText, loginType === 'surveyor' && styles.toggleTextActive]}>Surveyor</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Phone Number"
            placeholderTextColor="#999"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            maxLength={10}
          />

          <View style={styles.pinContainer}>
            <TextInput
              style={[styles.input, styles.pinInput, { marginBottom: 0, flex: 1 }]}
              placeholder="••••"
              placeholderTextColor="#999"
              secureTextEntry={!showPassword}
              keyboardType="number-pad"
              maxLength={4}
              value={password}
              onChangeText={(text) => setPassword(text.replace(/[^0-9]/g, '').slice(0, 4))}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
            >
              <MaterialIcons
                name={showPassword ? 'visibility-off' : 'visibility'}
                size={22}
                color="#666"
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>Login</Text>
            )}
          </TouchableOpacity>

          {/* <TouchableOpacity style={styles.otpButton} onPress={handleOTPLogin}>
            <Text style={styles.otpButtonText}>Login with OTP instead</Text>
          </TouchableOpacity> */}

          {loginType === 'surveyor' && (
            <TouchableOpacity
              style={styles.registerLink}
              onPress={() => router.push('/surveyor-profile')}
            >
              <Text style={styles.registerText}>New surveyor? <Text style={styles.registerTextBold}>Register here</Text></Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 16,
  },
  brandName: {
    fontSize: 32,
    fontWeight: '600',
    color: '#2D2D2D',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 24,
    padding: 24,
    paddingVertical: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#F0F0F0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: AppColors.primary,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  toggleTextActive: {
    color: '#FFF',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#FFF',
    marginBottom: 16,
  },
  pinInput: {
    textAlign: 'center',
    fontSize: 20,
    letterSpacing: 8,
  },
  pinContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    padding: 8,
  },
  button: {
    backgroundColor: AppColors.primary,
    borderRadius: 24,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  otpButton: {
    alignItems: 'center',
    marginTop: 16,
  },
  otpButtonText: {
    color: AppColors.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  registerLink: {
    alignItems: 'center',
    marginTop: 16,
  },
  registerText: {
    color: '#666',
    fontSize: 14,
  },
  registerTextBold: {
    color: AppColors.primary,
    fontWeight: '600',
  },
});
