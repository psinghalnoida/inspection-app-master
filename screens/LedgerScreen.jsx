import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '../constants/theme';
import api from '../lib/api';

const formatINR = (amount) =>
  `₹${parseFloat(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (dt) => {
  if (!dt) return '';
  return new Date(dt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

// v2 §4 — the server owns the sign convention and hands us `direction` + `label`
// for the headline balance. This only styles what it already told us.
const directionStyle = (direction) => {
  switch (direction) {
    case 'assigner_owes':
      return { bg: '#FFF0F0', text: '#C62828', icon: 'account-balance-wallet' };
    case 'admin_owes':
      return { bg: '#E8F5E9', text: '#2E7D32', icon: 'account-balance' };
    default:
      return { bg: '#F5F5F5', text: '#555', icon: 'check-circle' };
  }
};

const directionNote = (direction) => {
  switch (direction) {
    case 'assigner_owes':
      return 'Outstanding across all your surveys. Settle it to unlock any withheld reports.';
    case 'admin_owes':
      return 'Held in your favour. It adjusts against your next invoice, or can be refunded to your bank.';
    default:
      return 'Your account is fully settled. Nothing is due either way.';
  }
};

// The per-row running balance carries no server label, so it mirrors the same
// convention: positive = you owe, negative = credit. Never shown as a negative due.
const describeRowBalance = (value) => {
  const v = parseFloat(value || 0);
  if (v > 0) return { text: `${formatINR(v)} due`, color: '#C62828' };
  if (v < 0) return { text: `${formatINR(Math.abs(v))} credit`, color: '#2E7D32' };
  return { text: 'Settled', color: '#666' };
};

export default function LedgerScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [entries, setEntries] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchLedger(1, true);
  }, []);

  const fetchLedger = async (nextPage, replace = false) => {
    if (replace) {
      setLoading(true);
      setLoadError(false);
    } else setLoadingMore(true);
    try {
      const statementRes = await api.get('/assigner/ledger', { page: nextPage, limit: 20 });
      const items = statementRes.data || [];
      setEntries((prev) => (replace ? items : [...prev, ...items]));
      setPage(nextPage);
      setTotalPages(statementRes.pagination?.totalPages || 1);

      // The balance summary rides on its own endpoint; only refresh it on a
      // full reload, not when paging further back through the statement.
      if (replace) {
        const summaryRes = await api.get('/assigner/ledger/summary');
        setSummary(summaryRes.data || null);
      }
    } catch (err) {
      console.error('Failed to load ledger:', err);
      // A failed load must never fall back to "Settled ₹0.00" — that is a
      // balance the assigner does not have.
      if (replace) {
        setSummary(null);
        setLoadError(true);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const renderItem = ({ item }) => {
    const isDebit = item.entry_type === 'debit';
    const bal = describeRowBalance(item.balance_after);
    const meta = [item.invoice_number, item.laid ? `LAID ${item.laid}` : null]
      .filter(Boolean)
      .join('  •  ');

    return (
      <View style={styles.card}>
        <View style={styles.entryRow}>
          <View style={[styles.entryIcon, { backgroundColor: isDebit ? '#FFEBEE' : '#E8F5E9' }]}>
            <MaterialIcons
              name={isDebit ? 'arrow-upward' : 'arrow-downward'}
              size={18}
              color={isDebit ? '#C62828' : '#2E7D32'}
            />
          </View>
          <View style={styles.entryBody}>
            <Text style={styles.entryDescription} numberOfLines={2}>
              {item.description || (isDebit ? 'Debit' : 'Credit')}
            </Text>
            <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
            {meta ? <Text style={styles.refText}>{meta}</Text> : null}
          </View>
          <View style={styles.entryAmountCol}>
            <Text style={[styles.entryAmount, { color: isDebit ? '#C62828' : '#2E7D32' }]}>
              {isDebit ? '+' : '−'}
              {formatINR(item.amount)}
            </Text>
            <Text style={styles.entryType}>{isDebit ? 'Debit' : 'Credit'}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Balance after</Text>
          <Text style={[styles.rowValue, styles.rowValueStrong, { color: bal.color }]}>{bal.text}</Text>
        </View>
      </View>
    );
  };

  const dir = directionStyle(summary?.direction);
  const outstanding = summary?.outstanding_invoices || [];

  const listHeader = (
    <View>
      {summary ? (
        <View style={[styles.balanceCard, { backgroundColor: dir.bg }]}>
          <View style={styles.balanceHeaderRow}>
            <MaterialIcons name={dir.icon} size={20} color={dir.text} />
            <Text style={[styles.balanceLabel, { color: dir.text }]}>{summary.label || 'Settled'}</Text>
          </View>
          <Text style={[styles.balanceAmount, { color: dir.text }]}>{formatINR(summary.amount)}</Text>
          <Text style={styles.balanceNote}>{directionNote(summary.direction)}</Text>
        </View>
      ) : (
        <View style={[styles.balanceCard, { backgroundColor: '#FFF0F0' }]}>
          <View style={styles.balanceHeaderRow}>
            <MaterialIcons name="error-outline" size={20} color="#C62828" />
            <Text style={[styles.balanceLabel, { color: '#C62828' }]}>Balance unavailable</Text>
          </View>
          <Text style={styles.balanceNote}>
            We could not load your account just now. Nothing here is a statement of what you owe.
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => fetchLedger(1, true)}
            accessibilityRole="button"
            accessibilityLabel="Retry loading your ledger"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {outstanding.length > 0 && (
        <>
          <Text style={styles.blockTitle}>Outstanding Invoices</Text>
          <View style={styles.invoiceBlock}>
            {outstanding.map((inv) => (
              <TouchableOpacity
                key={inv.id}
                style={styles.invoiceRow}
                disabled={!inv.survey_id}
                onPress={() => router.push(`/survey-detail/${inv.survey_id}`)}
                accessibilityRole={inv.survey_id ? 'button' : undefined}
                accessibilityLabel={`Invoice ${inv.invoice_number || inv.id}, ${formatINR(inv.balance_due)} due. Open survey.`}
              >
                <View style={styles.invoiceMain}>
                  <Text style={styles.invoiceNumber} numberOfLines={1}>
                    {inv.invoice_number || `Invoice #${inv.id}`}
                  </Text>
                  <Text style={styles.invoiceMeta} numberOfLines={1}>
                    {[inv.laid ? `LAID ${inv.laid}` : null, formatDate(inv.issued_at)]
                      .filter(Boolean)
                      .join('  •  ')}
                  </Text>
                  <Text style={styles.invoiceMeta}>Invoice total {formatINR(inv.total_amount)}</Text>
                </View>
                <View style={styles.invoiceAmountCol}>
                  <Text style={styles.invoiceDue}>{formatINR(inv.balance_due)}</Text>
                  <Text style={styles.invoiceDueLabel}>due</Text>
                </View>
                {inv.survey_id ? (
                  <MaterialIcons name="chevron-right" size={22} color="#CCC" />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.blockTitle}>Statement</Text>
    </View>
  );

  const listFooter =
    page < totalPages ? (
      <TouchableOpacity
        style={styles.loadMoreBtn}
        onPress={() => fetchLedger(page + 1)}
        disabled={loadingMore}
        accessibilityRole="button"
        accessibilityLabel="Load more statement entries"
      >
        {loadingMore ? (
          <ActivityIndicator size="small" color={AppColors.primary} />
        ) : (
          <Text style={styles.loadMoreText}>Load more</Text>
        )}
      </TouchableOpacity>
    ) : null;

  const emptyComponent = (
    <View style={styles.emptyContainer}>
      <MaterialIcons name={loadError ? 'cloud-off' : 'receipt-long'} size={56} color="#CCC" />
      <Text style={styles.emptyText}>
        {loadError ? 'Statement could not be loaded' : 'No ledger entries yet'}
      </Text>
      <Text style={styles.emptySubtext}>
        {loadError
          ? 'Check your connection and retry — this is not an empty account.'
          : 'Invoices and payments will appear here as they happen.'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Payment Ledger</Text>
          <Text style={styles.headerSubtitle}>One running account across all your surveys</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={AppColors.primary} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          ListEmptyComponent={emptyComponent}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A1A1A' },
  headerSubtitle: { fontSize: 13, color: '#666', marginTop: 2 },
  listContent: { paddingBottom: 40 },
  balanceCard: {
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
  },
  balanceHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balanceLabel: { fontSize: 13, fontWeight: '600' },
  balanceAmount: { fontSize: 30, fontWeight: '700', marginTop: 6 },
  balanceNote: { fontSize: 12, color: '#555', marginTop: 6, lineHeight: 17 },
  retryBtn: { alignSelf: 'flex-start', paddingVertical: 12, paddingRight: 16, minHeight: 44, justifyContent: 'center' },
  retryText: { color: '#C62828', fontWeight: '700', fontSize: 14 },
  blockTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#666',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  invoiceBlock: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    marginHorizontal: 16,
    paddingHorizontal: 16,
  },
  invoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  invoiceMain: { flex: 1, marginRight: 8 },
  invoiceNumber: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  invoiceMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  invoiceAmountCol: { alignItems: 'flex-end', marginRight: 4 },
  invoiceDue: { fontSize: 15, fontWeight: '700', color: '#C62828' },
  invoiceDueLabel: { fontSize: 11, color: '#999', marginTop: 1 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  entryRow: { flexDirection: 'row', alignItems: 'flex-start' },
  entryIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  entryBody: { flex: 1, marginRight: 8 },
  entryDescription: { fontSize: 14, fontWeight: '600', color: '#1A1A1A', lineHeight: 19 },
  entryAmountCol: { alignItems: 'flex-end' },
  entryAmount: { fontSize: 15, fontWeight: '700' },
  entryType: { fontSize: 11, color: '#999', marginTop: 2 },
  dateText: { fontSize: 12, color: '#999', marginTop: 3 },
  refText: { fontSize: 12, color: '#999', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  rowLabel: { fontSize: 13, color: '#666' },
  rowValue: { fontSize: 13, color: '#1A1A1A' },
  rowValueStrong: { fontWeight: '700' },
  loadMoreBtn: {
    marginTop: 8,
    marginBottom: 20,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    minHeight: 44,
    justifyContent: 'center',
  },
  loadMoreText: { color: AppColors.primary, fontWeight: '600' },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyText: { fontSize: 14, color: '#999' },
  emptySubtext: { fontSize: 12, color: '#BBB', textAlign: 'center' },
});
