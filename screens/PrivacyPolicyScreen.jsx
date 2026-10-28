import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PrivacyPolicyScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Privacy Policy</Text>
                <View style={{ width: 32 }} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                <Text style={styles.lastUpdated}>Last Updated: January 2026</Text>

                <Text style={styles.sectionTitle}>1. Information We Collect</Text>
                <Text style={styles.paragraph}>
                    We collect information you provide directly, including your name, phone number, email address, and company details. For surveyors, we also collect location data during active surveys.
                </Text>

                <Text style={styles.sectionTitle}>2. How We Use Your Information</Text>
                <Text style={styles.paragraph}>
                    Your information is used to provide our services, verify survey locations, communicate with you about your account, and improve our platform. We do not sell your personal information to third parties.
                </Text>

                <Text style={styles.sectionTitle}>3. Location Data</Text>
                <Text style={styles.paragraph}>
                    Location data is collected only during active survey assignments and is used to verify surveyor presence at claim sites. You can control location permissions through your device settings.
                </Text>

                <Text style={styles.sectionTitle}>4. Data Security</Text>
                <Text style={styles.paragraph}>
                    We implement industry-standard security measures to protect your information. All data transmissions are encrypted, and access to personal data is restricted to authorized personnel only.
                </Text>

                <Text style={styles.sectionTitle}>5. Data Retention</Text>
                <Text style={styles.paragraph}>
                    We retain your information for as long as your account is active or as needed to provide services. Survey data is retained as required by insurance industry regulations.
                </Text>

                <Text style={styles.sectionTitle}>6. Your Rights</Text>
                <Text style={styles.paragraph}>
                    You have the right to access, correct, or delete your personal information. You can update your profile through the app or contact us for assistance with data requests.
                </Text>

                <Text style={styles.sectionTitle}>7. Third-Party Services</Text>
                <Text style={styles.paragraph}>
                    We may use third-party services for analytics, notifications, and payment processing. These services have their own privacy policies governing the use of your information.
                </Text>

                <Text style={styles.sectionTitle}>8. Contact Us</Text>
                <Text style={styles.paragraph}>
                    For privacy-related questions or concerns, please contact us at privacy@claimsmitra.com
                </Text>

                <View style={{ height: 100 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FAFAFA',
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
    content: {
        flex: 1,
        paddingHorizontal: 20,
    },
    lastUpdated: {
        fontSize: 12,
        color: '#999',
        marginTop: 20,
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1A1A1A',
        marginBottom: 8,
        marginTop: 16,
    },
    paragraph: {
        fontSize: 14,
        color: '#666',
        lineHeight: 22,
    },
});
