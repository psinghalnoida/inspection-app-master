import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categoryLabel, getMediaUrl } from '../../constants/config';
import { AppColors } from '../../constants/theme';
import { useAuth } from '../../app/_layout';
import { useTabBarClearance } from '../../components/CustomTabBar';
import surveyorService from '../../lib/surveyorService';
import api from '../../lib/api';

export default function SurveyorProfileScreen() {
    const router = useRouter();
    const { signOut } = useAuth();
    const tabBarClearance = useTabBarClearance();
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loggingOut, setLoggingOut] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deletePassword, setDeletePassword] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [invites, setInvites] = useState(null);
    const [respondingTo, setRespondingTo] = useState(null);

    useEffect(() => {
        fetchProfile();
    }, []);

    // An invite can land while this tab is already mounted — the notification
    // deep-links here — so re-read it whenever the screen comes into focus.
    useFocusEffect(
        useCallback(() => {
            fetchInvites();
        }, [])
    );

    const fetchInvites = async () => {
        try {
            const res = await api.get('/surveyor/team-invites');
            setInvites(res.data || null);
        } catch (error) {
            console.error('Error fetching team invites:', error);
        }
    };

    const fetchProfile = async () => {
        try {
            const data = await surveyorService.getProfile();
            setProfile(data);
        } catch (error) {
            console.error('Error fetching profile:', error);
            if (error.message?.includes('Session expired') ||
                error.message?.includes('Token expired') ||
                error.message?.includes('Invalid token') ||
                error.message?.includes('Unauthorized') ||
                error.status === 401) {
                signOut();
                return;
            }
        } finally {
            setLoading(false);
        }
    };

    // company_name is nullable — fall back to the person, then a generic label.
    const employerName = (invite) =>
        invite?.company_name || invite?.contact_person_name || 'This company';

    const respondToInvite = async (assignerId, action) => {
        setRespondingTo(assignerId);
        try {
            const res = await api.put(`/surveyor/team-invites/${assignerId}`, { action });
            Alert.alert(
                action === 'accept' ? 'Invitation Accepted' : 'Invitation Declined',
                res.message || 'Your response has been recorded.'
            );
        } catch (error) {
            // 409 means someone already answered it — refreshing below fixes the list.
            Alert.alert('Error', error.message || 'Could not send your response. Please try again.');
        } finally {
            setRespondingTo(null);
            fetchInvites();
        }
    };

    const handleAcceptInvite = (invite) => {
        const company = employerName(invite);

        // The consequence is material and near-irreversible: a non-Prime surveyor
        // who accepts leaves the open pool entirely. Say so before they tap.
        if (invites?.accepting_removes_from_open_pool) {
            Alert.alert(
                'You will stop receiving open survey requests',
                `If you join ${company}, ClaimsMitra will stop sending you open survey requests. ` +
                `All of your work — and your payment — will come directly from ${company}.\n\n` +
                'Only accept if you have agreed to work for them.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Accept anyway',
                        style: 'destructive',
                        onPress: () => respondToInvite(invite.assigner_id, 'accept'),
                    },
                ]
            );
            return;
        }

        respondToInvite(invite.assigner_id, 'accept');
    };

    const handleDeclineInvite = (invite) => {
        Alert.alert(
            'Decline Invitation',
            `Decline the invitation from ${employerName(invite)}? They can invite you again later.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Decline',
                    style: 'destructive',
                    onPress: () => respondToInvite(invite.assigner_id, 'decline'),
                },
            ]
        );
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
                                await api.post('/auth/surveyor/logout', {});
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
            router.push('/surveyor-edit-profile');
        } else if (route === 'change-password') {
            router.push('/surveyor-change-password');
        } else if (route === 'terms') {
            router.push('/terms');
        } else if (route === 'privacy') {
            router.push('/privacy');
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
            await api.post('/auth/surveyor/delete-account', { password: deletePassword });
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

    const getProfileImage = () => {
        return getMediaUrl(profile?.profile_picture_url)
            || 'https://ui-avatars.com/api/?name=' + (profile?.full_name || 'Surveyor') + '&background=random';
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

    const formatValidUntil = (value) => {
        if (!value) return '';
        const d = new Date(value);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
    };

    // categories is the authoritative list; category_grants adds licence details.
    const categories = profile?.categories || [];
    const grantByCategory = {};
    (profile?.category_grants || []).forEach((g) => { grantByCategory[g.category] = g; });
    const grants = categories.map((c) => grantByCategory[c] || { category: c });
    // is_prime is derived from categories — stay defensive about a missing flag.
    const isPrime = !!profile?.is_prime || categories.length > 0;

    const pendingInvites = invites?.pending || [];
    const acceptedInvites = invites?.accepted || [];
    // Server-decided: TRUE means accepting an invite ends open survey requests.
    const losesOpenPool = !!invites?.accepting_removes_from_open_pool;

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <ScrollView showsVerticalScrollIndicator={false}>
                {/* Header */}
                <Text style={styles.headerTitle}>Profile & Settings</Text>

                {/* Profile Section */}
                <View style={styles.profileSection}>
                    <View style={styles.avatarContainer}>
                        <Image
                            source={{ uri: getProfileImage() }}
                            style={styles.avatar}
                            contentFit="cover"
                        />
                        {profile?.is_available && (
                            <View style={styles.availableBadge}>
                                <View style={styles.availableDot} />
                            </View>
                        )}
                    </View>
                    <Text style={styles.profileName}>
                        {profile?.full_name || 'Surveyor'}
                    </Text>
                    <Text style={styles.profilePhone}>{formatPhone(profile?.phone)}</Text>
                    <View style={[styles.statusBadge, {
                        backgroundColor: profile?.verification_status === 'verified' ? '#E8F5E9' : '#FFF3E0'
                    }]}>
                        <Text style={[styles.statusText, {
                            color: profile?.verification_status === 'verified' ? '#4CAF50' : '#FF9800'
                        }]}>
                            {profile?.verification_status === 'verified' ? '✓ Verified' : '⏳ Pending Verification'}
                        </Text>
                    </View>
                    {profile && (
                        <View style={styles.capabilityRow}>
                            {isPrime ? (
                                <View style={styles.primeBadge}>
                                    <MaterialIcons name="star" size={14} color="#B26A00" />
                                    <Text style={styles.primeBadgeText}>PRIME SURVEYOR</Text>
                                </View>
                            ) : (
                                <View style={styles.investigatorBadge}>
                                    <MaterialIcons name="search" size={14} color="#5B67CA" />
                                    <Text style={styles.investigatorBadgeText}>INVESTIGATOR</Text>
                                </View>
                            )}
                        </View>
                    )}
                </View>

                {/* Licensed Categories */}
                {profile && (
                    <>
                        <Text style={styles.sectionTitle}>Licensed Categories</Text>
                        <View style={styles.menuCard}>
                            {grants.length > 0 ? (
                                grants.map((grant, index) => (
                                    <View
                                        key={grant.category}
                                        style={[styles.grantRow, index < grants.length - 1 && styles.menuItemBorder]}
                                    >
                                        <View style={styles.categoryChip}>
                                            <Text style={styles.categoryChipText}>{categoryLabel(grant.category)}</Text>
                                        </View>
                                        <View style={styles.grantMeta}>
                                            {grant.license_number ? (
                                                <Text style={styles.grantMetaText}>Licence {grant.license_number}</Text>
                                            ) : null}
                                            {formatValidUntil(grant.valid_until) ? (
                                                <Text style={styles.grantMetaText}>
                                                    Valid till {formatValidUntil(grant.valid_until)}
                                                </Text>
                                            ) : null}
                                        </View>
                                    </View>
                                ))
                            ) : (
                                <View style={styles.investigatorOnlyRow}>
                                    <View style={[styles.iconContainer, { backgroundColor: '#EEF0FF' }]}>
                                        <MaterialIcons name="search" size={22} color="#5B67CA" />
                                    </View>
                                    <View style={styles.investigatorOnlyTextWrap}>
                                        <Text style={styles.investigatorOnlyTitle}>Investigator</Text>
                                        <Text style={styles.investigatorOnlyText}>
                                            You can take investigation cases. No licensed categories have been granted yet — contact admin to add categories and become a Prime surveyor.
                                        </Text>
                                    </View>
                                </View>
                            )}
                        </View>
                    </>
                )}

                {/* Team Invitations */}
                {pendingInvites.length + acceptedInvites.length > 0 && (
                    <>
                        <Text style={styles.sectionTitle}>Team Invitations</Text>
                        <View style={styles.menuCard}>
                            {pendingInvites.map((invite, index) => (
                                <View
                                    key={invite.invite_id}
                                    style={[
                                        styles.inviteRow,
                                        (index < pendingInvites.length - 1 || acceptedInvites.length > 0) &&
                                        styles.menuItemBorder,
                                    ]}
                                >
                                    <View style={styles.inviteHeader}>
                                        <View style={[styles.iconContainer, { backgroundColor: '#FFF5E5' }]}>
                                            <MaterialIcons name="group-add" size={22} color="#FFA726" />
                                        </View>
                                        <View style={styles.inviteTextWrap}>
                                            <Text style={styles.inviteName}>{employerName(invite)}</Text>
                                            <Text style={styles.inviteMeta}>
                                                {[invite.city, invite.state].filter(Boolean).join(', ') || 'Invitation pending'}
                                            </Text>
                                            <View style={styles.pendingBadge}>
                                                <MaterialIcons name="schedule" size={12} color="#B26A00" />
                                                <Text style={styles.pendingBadgeText}>
                                                    AWAITING YOUR RESPONSE
                                                </Text>
                                            </View>
                                        </View>
                                    </View>

                                    <View style={styles.inviteWarnBox}>
                                        <MaterialIcons
                                            name={losesOpenPool ? 'warning' : 'info-outline'}
                                            size={16}
                                            color={losesOpenPool ? '#C62828' : '#5B67CA'}
                                        />
                                        <Text
                                            style={[
                                                styles.inviteWarnText,
                                                losesOpenPool && styles.inviteWarnTextDanger,
                                            ]}
                                        >
                                            {losesOpenPool
                                                ? `If you accept, you will stop receiving open survey requests. All your work and payment will come directly from ${employerName(invite)}.`
                                                : 'If you accept, you can take work from this company and will still receive open survey requests.'}
                                        </Text>
                                    </View>

                                    <View style={styles.inviteActions}>
                                        <TouchableOpacity
                                            style={[styles.inviteBtn, styles.inviteDeclineBtn]}
                                            onPress={() => handleDeclineInvite(invite)}
                                            disabled={respondingTo === invite.assigner_id}
                                            accessibilityRole="button"
                                            accessibilityLabel={`Decline invitation from ${employerName(invite)}`}
                                        >
                                            <Text style={styles.inviteDeclineText}>Decline</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.inviteBtn, styles.inviteAcceptBtn]}
                                            onPress={() => handleAcceptInvite(invite)}
                                            disabled={respondingTo === invite.assigner_id}
                                            accessibilityRole="button"
                                            accessibilityLabel={`Accept invitation from ${employerName(invite)}`}
                                        >
                                            {respondingTo === invite.assigner_id ? (
                                                <ActivityIndicator size="small" color="#FFF" />
                                            ) : (
                                                <Text style={styles.inviteAcceptText}>Accept</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ))}

                            {acceptedInvites.map((member, index) => (
                                <View
                                    key={member.invite_id}
                                    style={[
                                        styles.inviteRow,
                                        index < acceptedInvites.length - 1 && styles.menuItemBorder,
                                    ]}
                                >
                                    <View style={styles.inviteHeader}>
                                        <View style={[styles.iconContainer, { backgroundColor: '#E8F5E9' }]}>
                                            <MaterialIcons name="business-center" size={22} color="#4CAF50" />
                                        </View>
                                        <View style={styles.inviteTextWrap}>
                                            <Text style={styles.inviteName}>{employerName(member)}</Text>
                                            <Text style={styles.inviteMeta}>
                                                You work for them
                                                {formatValidUntil(member.responded_at)
                                                    ? ` · since ${formatValidUntil(member.responded_at)}`
                                                    : ''}
                                            </Text>
                                            <View style={styles.memberBadge}>
                                                <MaterialIcons name="check-circle" size={12} color="#2E7D32" />
                                                <Text style={styles.memberBadgeText}>TEAM MEMBER</Text>
                                            </View>
                                        </View>
                                    </View>
                                    {losesOpenPool && (
                                        <Text style={styles.inviteFootnote}>
                                            You do not receive open survey requests — {employerName(member)} assigns
                                            your work directly.
                                        </Text>
                                    )}
                                </View>
                            ))}
                        </View>
                    </>
                )}

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

                {/* Wallet Section */}
                <Text style={styles.sectionTitle}>Earnings</Text>
                <View style={styles.menuCard}>
                    <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/wallet')}>
                        <View style={[styles.iconContainer, { backgroundColor: '#E8F5E9' }]}>
                            <MaterialIcons name="account-balance-wallet" size={22} color="#4CAF50" />
                        </View>
                        <Text style={styles.menuItemText}>My Wallet</Text>
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

                {/* Legal Section */}
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
        position: 'relative',
    },
    avatar: {
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 3,
        borderColor: '#E0E0E0',
        backgroundColor: '#CCC',
    },
    availableBadge: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        backgroundColor: '#FFF',
        borderRadius: 12,
        padding: 3,
    },
    availableDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#4CAF50',
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
        marginBottom: 8,
    },
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        fontSize: 13,
        fontWeight: '500',
    },
    capabilityRow: {
        flexDirection: 'row',
        marginTop: 10,
    },
    primeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#FFF3E0',
        borderWidth: 1,
        borderColor: '#FFCC80',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    primeBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#B26A00',
        letterSpacing: 0.4,
    },
    investigatorBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#EEF0FF',
        borderWidth: 1,
        borderColor: '#D5DAFB',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    investigatorBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#5B67CA',
        letterSpacing: 0.4,
    },
    grantRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 10,
    },
    categoryChip: {
        backgroundColor: '#F2F3F7',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    categoryChipText: {
        fontSize: 13,
        color: '#5A5F73',
        fontWeight: '500',
    },
    grantMeta: {
        flex: 1,
        alignItems: 'flex-end',
    },
    grantMetaText: {
        fontSize: 12,
        color: '#999',
    },
    investigatorOnlyRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 14,
        paddingHorizontal: 16,
    },
    investigatorOnlyTextWrap: {
        flex: 1,
    },
    investigatorOnlyTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1A1A1A',
        marginBottom: 4,
    },
    investigatorOnlyText: {
        fontSize: 13,
        color: '#666',
        lineHeight: 19,
    },
    inviteRow: {
        paddingVertical: 14,
        paddingHorizontal: 16,
    },
    inviteHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    inviteTextWrap: {
        flex: 1,
    },
    inviteName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    inviteMeta: {
        fontSize: 13,
        color: '#666',
        marginTop: 2,
    },
    pendingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        backgroundColor: '#FFF3E0',
        borderWidth: 1,
        borderColor: '#FFCC80',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 2,
        marginTop: 6,
    },
    pendingBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#B26A00',
        letterSpacing: 0.4,
    },
    memberBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        backgroundColor: '#E8F5E9',
        borderWidth: 1,
        borderColor: '#A5D6A7',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 2,
        marginTop: 6,
    },
    memberBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#2E7D32',
        letterSpacing: 0.4,
    },
    inviteWarnBox: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        backgroundColor: '#FAFAFA',
        borderRadius: 12,
        padding: 10,
        marginTop: 12,
    },
    inviteWarnText: {
        flex: 1,
        fontSize: 13,
        color: '#5A5F73',
        lineHeight: 18,
    },
    inviteWarnTextDanger: {
        color: '#C62828',
        fontWeight: '500',
    },
    inviteFootnote: {
        fontSize: 12,
        color: '#666',
        lineHeight: 17,
        marginTop: 10,
    },
    inviteActions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 12,
    },
    inviteBtn: {
        flex: 1,
        minHeight: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inviteDeclineBtn: {
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    inviteDeclineText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#666',
    },
    inviteAcceptBtn: {
        backgroundColor: AppColors.primary,
    },
    inviteAcceptText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#FFF',
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
