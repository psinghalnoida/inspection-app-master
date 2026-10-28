import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
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

export default function SetMpinScreen() {
  const [mpin, setMpin] = useState(['', '', '', '']);
  const [confirmMpin, setConfirmMpin] = useState(['', '', '', '']);
  const mpinRefs = useRef([]);
  const confirmRefs = useRef([]);
  const router = useRouter();

  const handleMpinChange = (value, index, isConfirm = false) => {
    if (value.length > 1) return;

    const setter = isConfirm ? setConfirmMpin : setMpin;
    const current = isConfirm ? confirmMpin : mpin;
    const refs = isConfirm ? confirmRefs : mpinRefs;

    const newPin = [...current];
    newPin[index] = value;
    setter(newPin);

    if (value && index < 3) {
      refs.current[index + 1]?.focus();
    } else if (value && index === 3 && !isConfirm) {
      confirmRefs.current[0]?.focus();
    }
  };

  const handleKeyPress = (e, index, isConfirm = false) => {
    const current = isConfirm ? confirmMpin : mpin;
    const refs = isConfirm ? confirmRefs : mpinRefs;

    if (e.nativeEvent.key === 'Backspace' && !current[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handleVerify = () => {
    const pin = mpin.join('');
    const confirm = confirmMpin.join('');

    if (pin.length !== 4 || confirm.length !== 4) {
      alert('Please enter 4-digit MPIN');
      return;
    }

    if (pin !== confirm) {
      alert('MPIN does not match');
      return;
    }

    console.log('MPIN set:', pin);
    // For surveyor flow, navigate to surveyor tabs
    // For assigner flow, navigate to regular tabs
    router.replace('/(surveyor-tabs)');
  };

  const renderPinInputs = (values, refs, isConfirm) => (
    <View style={styles.pinContainer}>
      {values.map((digit, index) => (
        <TextInput
          key={index}
          ref={(ref) => (refs.current[index] = ref)}
          style={styles.pinInput}
          value={digit}
          onChangeText={(value) => handleMpinChange(value, index, isConfirm)}
          onKeyPress={(e) => handleKeyPress(e, index, isConfirm)}
          keyboardType="number-pad"
          maxLength={1}
          secureTextEntry
          selectTextOnFocus
        />
      ))}
    </View>
  );

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
          <View style={styles.logoWrapper}>
            <View style={styles.logoOuter}>
              <View style={styles.logoInner} />
            </View>
          </View>
          <Text style={styles.brandName}>Claims Mitra</Text>
        </View>

        {/* MPIN Card */}
        <View style={styles.card}>
          <Text style={styles.title}>Set your MPIN</Text>

          <Text style={styles.label}>Enter MPIN</Text>
          {renderPinInputs(mpin, mpinRefs, false)}

          <Text style={styles.label}>Confirm MPIN</Text>
          {renderPinInputs(confirmMpin, confirmRefs, true)}

          {/* Security Note */}
          <View style={styles.noteContainer}>
            <View style={styles.noteIcon}>
              <MaterialIcons name="security" size={18} color="#7B68EE" />
            </View>
            <Text style={styles.noteText}>
              Your MPIN is used to secure your transactions. Do not share it with anyone.
            </Text>
          </View>

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
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  pinContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  pinInput: {
    flex: 1,
    maxWidth: 70,
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    fontSize: 20,
    textAlign: 'center',
    backgroundColor: '#FFF',
    color: '#333',
    marginHorizontal: 6,
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 24,
    gap: 12,
  },
  noteIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },

  noteText: {
    flex: 1,
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
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
