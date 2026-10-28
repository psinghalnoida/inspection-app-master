import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TermsScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Terms & Conditions</Text>
                <View style={{ width: 32 }} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                <Text style={styles.lastUpdated}>Last Updated: January 2026</Text>

                <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
                <Text style={styles.paragraph}>
                    By accessing and using the Claims Mitra application, you agree to be bound by these Terms and Conditions. If you do not agree with any part of these terms, you may not use our services.
                </Text>

                <Text style={styles.sectionTitle}>2. Use of Service</Text>
                <Text style={styles.paragraph}>
                    Claims Mitra provides a platform for insurance claim management, connecting assigners with surveyors. You agree to use this service only for lawful purposes and in accordance with these terms.
                </Text>

                <Text style={styles.sectionTitle}>3. User Accounts</Text>
                <Text style={styles.paragraph}>
                    You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized use.
                </Text>

                <Text style={styles.sectionTitle}>4. Survey & Location Data</Text>
                <Text style={styles.paragraph}>
                    For the purpose of conducting surveys, location data may be collected and shared with authorized personnel. This data is used solely for survey verification and claim processing.
                </Text>

                <Text style={styles.sectionTitle}>5. Liability</Text>
                <Text style={styles.paragraph}>
                    Claims Mitra serves as a platform to facilitate connections between parties. We are not liable for the accuracy of survey reports or claim decisions made by insurance companies.
                </Text>

                <Text style={styles.sectionTitle}>6. Modifications</Text>
                <Text style={styles.paragraph}>
                    We reserve the right to modify these terms at any time. Continued use of the application after changes constitutes acceptance of the modified terms.
                </Text>

                <Text style={styles.sectionTitle}>7. Contact</Text>
                <Text style={styles.paragraph}>
                    For questions about these Terms & Conditions, please contact us at support@claimsmitra.com
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
