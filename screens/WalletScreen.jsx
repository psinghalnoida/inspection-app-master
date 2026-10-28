import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    RefreshControl,
    ActivityIndicator,
    TouchableOpacity,
    FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { surveyorService } from '../lib/surveyorService';
import { AppColors } from '../constants/theme';
import { useRouter } from 'expo-router';

const WalletScreen = () => {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [wallet, setWallet] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    const fetchWalletData = async (isRefresh = false) => {
        try {
            if (isRefresh) {
                setPage(1);
                setHasMore(true);
            }

            const balanceData = await surveyorService.getWalletBalance();
            setWallet(balanceData);

            const txnData = await surveyorService.getWalletTransactions({ page: 1, limit: 20 });
            setTransactions(txnData.transactions || []);
            setHasMore((txnData.pagination?.page || 1) < (txnData.pagination?.total_pages || 1));
        } catch (error) {
            console.error('Error fetching wallet data:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const loadMoreTransactions = async () => {
        if (loadingMore || !hasMore) return;

        setLoadingMore(true);
        try {
            const nextPage = page + 1;
            const txnData = await surveyorService.getWalletTransactions({ page: nextPage, limit: 20 });
            setTransactions(prev => [...prev, ...(txnData.transactions || [])]);
            setPage(nextPage);
            setHasMore(nextPage < (txnData.pagination?.total_pages || 1));
        } catch (error) {
            console.error('Error loading more transactions:', error);
        } finally {
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        fetchWalletData();
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchWalletData(true);
    }, []);

    const formatAmount = (amount) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount || 0);
    };

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Stats
    const creditCount = transactions.filter(t => t.type === 'credit').length;
    const debitCount = transactions.filter(t => t.type === 'debit').length;

    const renderTransaction = ({ item, index }) => {
        const isCredit = item.type === 'credit';

        return (
            <TouchableOpacity
                style={styles.txnCard}
                onPress={() => item.survey?.id && router.push(`/survey-detail/${item.survey.id}`)}
                activeOpacity={0.7}
            >
                {/* Amount Header */}
                <View style={styles.txnAmountRow}>
                    <Text style={[styles.txnAmountBig, { color: isCredit ? '#16A34A' : '#DC2626' }]}>
                        {isCredit ? '+' : '-'}{formatAmount(item.amount)}
                    </Text>
                    <View style={[styles.txnTypeBadge, { backgroundColor: isCredit ? '#DCFCE7' : '#FEE2E2' }]}>
                        <Text style={[styles.txnTypeText, { color: isCredit ? '#16A34A' : '#DC2626' }]}>
                            {isCredit ? 'Credit' : 'Debit'}
                        </Text>
                    </View>
                </View>

                {/* Info Rows */}
                <View style={styles.txnInfoGrid}>
                    <View style={styles.txnInfoRow}>
                        <Text style={styles.txnLabel}>Date</Text>
                        <Text style={styles.txnValue}>{formatDate(item.created_at)}</Text>
                    </View>

                    <View style={styles.txnInfoRow}>
                        <Text style={styles.txnLabel}>Status</Text>
                        <Text style={styles.txnValue}>
                            {(item.status || 'completed').charAt(0).toUpperCase() + (item.status || 'completed').slice(1)}
                        </Text>
                    </View>

                    {item.survey?.laid && (
                        <View style={styles.txnInfoRow}>
                            <Text style={styles.txnLabel}>Survey LAID</Text>
                            <Text style={[styles.txnValue, { color: '#6366F1', fontWeight: '600' }]}>{item.survey.laid}</Text>
                        </View>
                    )}

                    {item.balance_after !== undefined && (
                        <View style={styles.txnInfoRow}>
                            <Text style={styles.txnLabel}>Balance After</Text>
                            <Text style={styles.txnValue}>{formatAmount(item.balance_after)}</Text>
                        </View>
                    )}
                </View>

                {/* View Survey */}
                {item.survey?.id && (
                    <View style={styles.txnFooter}>
                        <Text style={styles.txnFooterText}>Tap to view survey</Text>
                        <MaterialIcons name="chevron-right" size={16} color="#9CA3AF" />
                    </View>
                )}
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={AppColors.primary} />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <MaterialIcons name="arrow-back-ios" size={20} color="#1F2937" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Wallet</Text>
                <View style={styles.headerRight} />
            </View>

            <FlatList
                data={transactions}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderTransaction}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[AppColors.primary]} />
                }
                onEndReached={loadMoreTransactions}
                onEndReachedThreshold={0.3}
                ListHeaderComponent={() => (
                    <View style={styles.headerContent}>
                        {/* Balance Card */}
                        <LinearGradient
                            colors={['#8B5CF6', '#6366F1']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.balanceCard}
                        >
                            <Text style={styles.balanceLabel}>Available Balance</Text>
                            <Text style={styles.balanceValue}>{formatAmount(wallet?.balance)}</Text>

                            <View style={styles.statsRow}>
                                <View style={styles.statItem}>
                                    <Text style={styles.statLabel}>Total Earned</Text>
                                    <Text style={styles.statValue}>{formatAmount(wallet?.total_earned)}</Text>
                                </View>
                                <View style={styles.statDivider} />
                                <View style={styles.statItem}>
                                    <Text style={styles.statLabel}>Withdrawn</Text>
                                    <Text style={styles.statValue}>{formatAmount(wallet?.total_withdrawn)}</Text>
                                </View>
                            </View>
                        </LinearGradient>

                        {/* Quick Stats
                        <View style={styles.quickStats}>
                            <View style={styles.quickItem}>
                                <Text style={styles.quickValue}>{creditCount}</Text>
                                <Text style={styles.quickLabel}>Credits</Text>
                            </View>
                            <View style={styles.quickDivider} />
                            <View style={styles.quickItem}>
                                <Text style={styles.quickValue}>{debitCount}</Text>
                                <Text style={styles.quickLabel}>Debits</Text>
                            </View>
                            <View style={styles.quickDivider} />
                            <View style={styles.quickItem}>
                                <Text style={styles.quickValue}>{transactions.length}</Text>
                                <Text style={styles.quickLabel}>Total</Text>
                            </View>
                        </View> */}



                        {/* Section Header */}
                        <Text style={styles.sectionTitle}>Transaction History</Text>
                    </View>
                )}
                ListEmptyComponent={() => (
                    <View style={styles.emptyState}>
                        <MaterialIcons name="receipt-long" size={48} color="#D1D5DB" />
                        <Text style={styles.emptyTitle}>No transactions yet</Text>
                        <Text style={styles.emptyText}>Complete surveys to start earning!</Text>
                    </View>
                )}
                ListFooterComponent={() =>
                    loadingMore ? (
                        <View style={styles.loadingMore}>
                            <ActivityIndicator size="small" color={AppColors.primary} />
                        </View>
                    ) : <View style={{ height: 20 }} />
                }
                contentContainerStyle={styles.listContent}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    backBtn: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: '#1F2937',
    },
    headerRight: {
        width: 36,
    },
    listContent: {
        paddingHorizontal: 16,
    },
    headerContent: {
        paddingTop: 16,
    },
    balanceCard: {
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
    },
    balanceLabel: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.8)',
        marginBottom: 6,
    },
    balanceValue: {
        fontSize: 32,
        fontWeight: '700',
        color: '#FFF',
        marginBottom: 20,
    },
    statsRow: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderRadius: 10,
        padding: 12,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
    },
    statLabel: {
        fontSize: 11,
        color: 'rgba(255,255,255,0.7)',
        marginBottom: 4,
    },
    statValue: {
        fontSize: 14,
        fontWeight: '600',
        color: '#FFF',
    },
    statDivider: {
        width: 1,
        backgroundColor: 'rgba(255,255,255,0.2)',
    },
    quickStats: {
        flexDirection: 'row',
        backgroundColor: '#F9FAFB',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    quickItem: {
        flex: 1,
        alignItems: 'center',
    },
    quickValue: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1F2937',
    },
    quickLabel: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 2,
    },
    quickDivider: {
        width: 1,
        backgroundColor: '#E5E7EB',
    },
    infoBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EEF2FF',
        borderRadius: 10,
        padding: 12,
        marginBottom: 20,
        gap: 8,
    },
    infoText: {
        flex: 1,
        fontSize: 12,
        color: '#4338CA',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1F2937',
        marginBottom: 12,
    },
    separator: {
        height: 12,
    },
    txnCard: {
        backgroundColor: '#F9FAFB',
        borderRadius: 12,
        padding: 16,
    },
    txnAmountRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    txnAmountBig: {
        fontSize: 22,
        fontWeight: '700',
    },
    txnTypeBadge: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
    },
    txnTypeText: {
        fontSize: 12,
        fontWeight: '600',
    },
    txnInfoGrid: {
        gap: 10,
    },
    txnInfoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    txnLabel: {
        fontSize: 13,
        color: '#6B7280',
    },
    txnValue: {
        fontSize: 13,
        fontWeight: '500',
        color: '#1F2937',
    },
    txnFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 14,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
    },
    txnFooterText: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 48,
    },
    emptyTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
        marginTop: 12,
    },
    emptyText: {
        fontSize: 13,
        color: '#9CA3AF',
        marginTop: 4,
    },
    loadingMore: {
        paddingVertical: 16,
        alignItems: 'center',
    },
});

export default WalletScreen;
