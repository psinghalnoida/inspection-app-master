import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { AppColors } from '../constants/theme';

export default function VerificationScreen() {
  const { phoneNumber: paramPhone } = useLocalSearchParams();
  const phoneNumber = paramPhone || '(+91) 98765 43210';
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [timer, setTimer] = useState(29);
  const inputRefs = useRef([]);
  const router = useRouter();

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer((t) => t - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const handleOtpChange = (value, index) => {
    if (value.length > 1) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = () => {
    const code = otp.join('');
    console.log('Verifying OTP:', code);
    router.push('/role-selection');
  };

  const handleResend = () => {
    if (timer === 0) {
      setTimer(29);
      // Resend OTP logic
    }
  };

  return (
    <LinearGradient colors={[AppColors.gradientStart, AppColors.gradientEnd]} style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        {/* Logo Section */}
        <View style={styles.logoContainer}>
          <View style={styles.logoWrapper}>
            <View style={styles.logoOuter}>
              <View style={styles.logoInner} />
            </View>
          </View>
          <Text style={styles.brandName}>Claims Mitra</Text>
        </View>

        {/* Verification Card */}
        <View style={styles.card}>
          <Text style={styles.title}>Enter Verification Code</Text>
          <Text style={styles.subtitle}>Enter the verification code sent to</Text>
          <Text style={styles.phoneNumber}>{phoneNumber}</Text>

          {/* OTP Input */}
          <View style={styles.otpContainer}>
            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => (inputRefs.current[index] = ref)}
                style={styles.otpInput}
                value={digit}
                onChangeText={(value) => handleOtpChange(value, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
              />
            ))}
          </View>

          {/* Resend Timer */}
          <Text style={styles.resendText}>
            Didn't received the code?{' '}
            {timer > 0 ? (
              <Text style={styles.timerText}>Resend in {timer} seconds</Text>
            ) : (
              <Text style={styles.resendLink} onPress={handleResend}>
                Resend
              </Text>
            )}
          </Text>

          <TouchableOpacity style={styles.button} onPress={handleVerify}>
            <Text style={styles.buttonText}>Verify & Continue</Text>
          </TouchableOpacity>
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
  logoWrapper: {
    marginBottom: 16,
  },
  logoOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 12,
    borderColor: '#A78BBA',
    borderTopColor: 'transparent',
    transform: [{ rotate: '-45deg' }],
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#B8A5C8',
    transform: [{ rotate: '45deg' }],
  },
  brandName: {
    fontSize: 32,
    fontWeight: '600',
    color: '#2D2D2D',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 32,
    padding: 32,
    paddingVertical: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  phoneNumber: {
    fontSize: 14,
    color: '#7B68EE',
    marginBottom: 24,
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  otpInput: {
    width: 48,
    height: 56,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    fontSize: 20,
    textAlign: 'center',
    backgroundColor: '#FFF',
    color: '#333',
  },
  resendText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 24,
  },
  timerText: {
    color: '#7B68EE',
    fontWeight: '500',
  },
  resendLink: {
    color: '#7B68EE',
    fontWeight: '600',
  },
  button: {
    backgroundColor: AppColors.primary,
    borderRadius: 24,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
