import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ALL_CATEGORIES, categoryLabel as labelFor } from '../constants/config';
import { AppColors } from '../constants/theme';
import api from '../lib/api';

// ponytail: prefix match covers the whole documented map
// (motor_spot / motor_final -> motor, marine_final / marine_cargo_investigation -> marine,
//  investigation -> none) without a lookup table to keep in sync.
export function requiredCategoryFor(surveyType) {
  const t = String(surveyType || '');
  if (t.startsWith('motor')) return 'motor';
  if (t.startsWith('marine')) return 'marine';
  return null;
}

// is_prime is derived server-side, but stay defensive about missing/0/1 values.
const isPrime = (m) => !!m?.is_prime || (m?.categories?.length || 0) > 0;

function PrimeBadge() {
  return (
    <View style={styles.primeBadge}>
      <MaterialIcons name="star" size={11} color="#B26A00" />
      <Text style={styles.primeBadgeText}>PRIME</Text>
    </View>
  );
}

function CategoryChips({ categories, highlight }) {
  if (!categories || categories.length === 0) {
    return <Text style={styles.investigatorOnly}>Investigator only</Text>;
  }
  return (
    <View style={styles.chipRow}>
      {categories.map((c) => (
        <View key={c} style={[styles.chip, highlight === c && styles.chipMatch]}>
          <Text style={[styles.chipText, highlight === c && styles.chipMatchText]}>
            {labelFor(c)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Picker for the assigner's surveyor team. Writes the selected
 * surveyor's phone to the parent so form submission keeps using the
 * existing `surveyor_mobile` field.
 *
 * v2 §2: membership is consent-based. The assigner invites by phone; only
 * surveyors who ACCEPTED are selectable — pending and declined invites are
 * listed for visibility but the server refuses to assign to them.
 *
 * v2 §1.4 (revised): the category rule gates BROADCAST only. Direct assignment
 * is a trust decision — the assigner may pick ANY accepted team member,
 * regardless of category. Category chips + the Prime badge are shown as
 * information, never as a gate. `surveyType` is still accepted for call-site
 * compatibility but no longer restricts the list.
 */
export default function SurveyorTeamPicker({ value, onChange, surveyType, onAvailabilityChange }) {
  // `team` is the ACCEPTED members only — the server rejects anyone else, so
  // pending/declined invites are shown but never made selectable.
  const [team, setTeam] = useState([]);
  const [pending, setPending] = useState([]);
  const [declined, setDeclined] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState(null);

  // Category gating is broadcast-only (v2 §1.4 revised). Forcing this to null
  // keeps every downstream "requiredCategory" guard on its permissive branch —
  // no member is ever disabled, sorted down, or blocked on the direct-assign
  // picker. The chips/badge stay purely informational.
  const requiredCategory = null;
  void surveyType;

  const loadTeam = async () => {
    const res = await api.get('/assigner/team');
    const data = res.data || res;
    setTeam(data.members || []);
    setPending(data.pending || []);
    setDeclined(data.declined || []);
    return data;
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await loadTeam();
        if (!alive) return;
        onAvailabilityChange?.(data.is_direct_assign !== false);
      } catch (err) {
        if (!alive) return;
        setError(err.message || 'Failed to load team');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Invite by phone (new surveyor) or by surveyor_id (re-invite a declined one).
  const sendInvite = async (body) => {
    setInviting(true);
    setNotice(null);
    try {
      const res = await api.post('/assigner/team/invite', body);
      setInvitePhone('');
      setNotice({
        ok: true,
        text: res.message || 'Invitation sent. They appear in your team once they accept.',
      });
      await loadTeam();
    } catch (err) {
      setNotice({ ok: false, text: err.message || 'Could not send the invitation' });
    } finally {
      setInviting(false);
    }
  };

  const selected = useMemo(
    () => team.find((m) => m.phone === value) || null,
    [team, value]
  );

  const isEligible = (m) =>
    !requiredCategory || (m.categories || []).includes(requiredCategory);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = team.filter((m) => {
      if (categoryFilter && !(m.categories || []).includes(categoryFilter)) return false;
      if (!q) return true;
      return (
        m.full_name?.toLowerCase().includes(q) ||
        m.phone?.includes(q) ||
        m.city?.toLowerCase().includes(q)
      );
    });
    if (!requiredCategory) return rows;
    // Eligible surveyors first; ineligible ones stay visible but marked.
    return [...rows].sort((a, b) => Number(isEligible(b)) - Number(isEligible(a)));
  }, [team, query, categoryFilter, requiredCategory]);

  if (loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator size="small" color={AppColors.primary} />
        <Text style={styles.stateText}>Loading your team…</Text>
      </View>
    );
  }

  if (error) {
    return <Text style={styles.errorText}>{error}</Text>;
  }

  const renderItem = ({ item }) => {
    const active = item.phone === value;
    const eligible = isEligible(item);
    return (
      <TouchableOpacity
        style={[styles.row, active && styles.rowActive, !eligible && styles.rowDisabled]}
        disabled={!eligible}
        accessibilityRole="button"
        accessibilityState={{ selected: active, disabled: !eligible }}
        accessibilityLabel={
          `${item.full_name}${isPrime(item) ? ', Prime surveyor' : ', Investigator only'}` +
          (eligible ? '' : `, not licensed for ${labelFor(requiredCategory)}, cannot be assigned`)
        }
        onPress={() => {
          onChange(item.phone);
          setOpen(false);
          setQuery('');
        }}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(item.full_name?.[0] || 'S').toUpperCase()}
          </Text>
        </View>
        <View style={styles.rowTextWrap}>
          <View style={styles.nameRow}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.full_name}
            </Text>
            {isPrime(item) && <PrimeBadge />}
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>
            +91 {item.phone}{item.city ? ` · ${item.city}` : ''}
          </Text>
          <CategoryChips categories={item.categories} highlight={requiredCategory} />
          {!eligible && (
            <View style={styles.blockedRow}>
              <MaterialIcons name="block" size={13} color="#C62828" />
              <Text style={styles.blockedText}>
                Not licensed for {labelFor(requiredCategory)} — cannot be assigned
              </Text>
            </View>
          )}
        </View>
        {active && (
          <MaterialIcons name="check" size={20} color={AppColors.primary} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          selected
            ? `Selected surveyor ${selected.full_name}. Change selection`
            : team.length > 0
              ? 'Select a surveyor from your team'
              : 'Invite a surveyor to your team'
        }
      >
        {selected ? (
          <View style={styles.selectedWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(selected.full_name?.[0] || 'S').toUpperCase()}
              </Text>
            </View>
            <View style={styles.selectedTextWrap}>
              <View style={styles.nameRow}>
                <Text style={styles.selectedName} numberOfLines={1}>
                  {selected.full_name}
                </Text>
                {isPrime(selected) && <PrimeBadge />}
              </View>
              <Text style={styles.selectedSub} numberOfLines={1}>
                +91 {selected.phone}
                {selected.city ? ` · ${selected.city}` : ''}
              </Text>
              <CategoryChips categories={selected.categories} highlight={requiredCategory} />
            </View>
          </View>
        ) : (
          <Text style={styles.placeholder}>
            {team.length > 0
              ? 'Select a surveyor from your team'
              : 'Invite a surveyor to your team'}
          </Text>
        )}
        <MaterialIcons name="arrow-drop-down" size={24} color="#999" />
      </TouchableOpacity>

      {team.length === 0 && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            No surveyor has accepted your team invitation yet. Tap above to invite one by mobile
            number, or leave this empty to broadcast to all surveyors instead.
          </Text>
          {pending.length > 0 && (
            <Text style={[styles.emptyText, styles.emptyTextSpaced]}>
              {pending.length} invitation{pending.length > 1 ? 's are' : ' is'} still awaiting a
              response. You can only assign directly once a surveyor accepts.
            </Text>
          )}
        </View>
      )}

      {requiredCategory && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>
            This survey needs a {labelFor(requiredCategory)} licence. Surveyors without it are marked and cannot be assigned directly.
          </Text>
        </View>
      )}

      {selected && (
        <TouchableOpacity
          onPress={() => onChange('')}
          style={styles.clearBtn}
          accessibilityRole="button"
          accessibilityLabel="Clear selected surveyor"
        >
          <Text style={styles.clearText}>Clear selection</Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel="Close surveyor picker"
            onPress={() => setOpen(false)}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Your Surveyor Team</Text>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <MaterialIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <View style={styles.inviteRow}>
              <Text style={styles.invitePrefix}>+91</Text>
              <TextInput
                value={invitePhone}
                onChangeText={(t) => setInvitePhone(t.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="Invite a surveyor by mobile number"
                placeholderTextColor="#999"
                keyboardType="phone-pad"
                maxLength={10}
                style={styles.inviteInput}
                accessibilityLabel="Mobile number of the surveyor to invite"
              />
              <TouchableOpacity
                style={[styles.inviteBtn, (inviting || invitePhone.length !== 10) && styles.inviteBtnDisabled]}
                onPress={() => sendInvite({ phone: invitePhone })}
                disabled={inviting || invitePhone.length !== 10}
                accessibilityRole="button"
                accessibilityLabel="Send team invitation"
              >
                {inviting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.inviteBtnText}>Invite</Text>
                )}
              </TouchableOpacity>
            </View>
            {notice ? (
              <Text style={[styles.inviteNotice, !notice.ok && styles.inviteNoticeError]}>
                {notice.text}
              </Text>
            ) : null}

            <View style={styles.searchWrap}>
              <MaterialIcons name="search" size={20} color="#999" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name, phone, or city"
                placeholderTextColor="#999"
                style={styles.searchInput}
                // Nothing to search when the team is empty — the invite field above
                // is what the assigner opened this sheet for.
                autoFocus={team.length > 0}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.filterScroll}
              contentContainerStyle={styles.filterRow}
            >
              {['', ...ALL_CATEGORIES].map((c) => {
                const activeFilter = categoryFilter === c;
                return (
                  <TouchableOpacity
                    key={c || 'all'}
                    style={[styles.filterChip, activeFilter && styles.filterChipActive]}
                    onPress={() => setCategoryFilter(c)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activeFilter }}
                    accessibilityLabel={c ? `Filter by ${labelFor(c)}` : 'Show all categories'}
                  >
                    <Text style={[styles.filterChipText, activeFilter && styles.filterChipTextActive]}>
                      {c ? labelFor(c) : 'All'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <FlatList
              data={filtered}
              extraData={value}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.emptySearch}>
                  {team.length === 0
                    ? 'No surveyor has accepted your invitation yet.'
                    : categoryFilter && !query.trim()
                      ? `No surveyors in your team hold a ${labelFor(categoryFilter)} licence.`
                      : 'No surveyors match your search.'}
                </Text>
              }
              ListFooterComponent={
                pending.length > 0 || declined.length > 0 ? (
                  <View style={styles.inviteStateWrap}>
                    {pending.length > 0 && (
                      <>
                        <Text style={styles.groupTitle}>Awaiting response ({pending.length})</Text>
                        {pending.map((m) => (
                          <View key={`pending-${m.id}`} style={styles.stateRow}>
                            <MaterialIcons name="schedule" size={18} color="#B26A00" />
                            <View style={styles.rowTextWrap}>
                              <Text style={styles.rowName} numberOfLines={1}>{m.full_name}</Text>
                              <Text style={styles.rowSub} numberOfLines={1}>
                                +91 {m.phone} · Invite sent, not accepted yet
                              </Text>
                            </View>
                          </View>
                        ))}
                      </>
                    )}
                    {declined.length > 0 && (
                      <>
                        <Text style={styles.groupTitle}>Declined ({declined.length})</Text>
                        {declined.map((m) => (
                          <View key={`declined-${m.id}`} style={styles.stateRow}>
                            <MaterialIcons name="block" size={18} color="#C62828" />
                            <View style={styles.rowTextWrap}>
                              <Text style={styles.rowName} numberOfLines={1}>{m.full_name}</Text>
                              <Text style={styles.rowSub} numberOfLines={1}>
                                +91 {m.phone} · Declined your invitation
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={styles.reinviteBtn}
                              onPress={() => sendInvite({ surveyor_id: m.id })}
                              disabled={inviting}
                              accessibilityRole="button"
                              accessibilityLabel={`Invite ${m.full_name} again`}
                            >
                              <Text style={styles.reinviteText}>Invite again</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </>
                    )}
                    <Text style={styles.stateFootnote}>
                      Only surveyors who have accepted can be assigned directly.
                    </Text>
                  </View>
                ) : null
              }
              contentContainerStyle={{ paddingBottom: 24 }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  state: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  stateText: { fontSize: 13, color: '#666' },
  errorText: { fontSize: 13, color: '#C62828', paddingVertical: 8 },
  emptyBox: {
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#FFE082',
    borderRadius: 12,
    padding: 12,
  },
  emptyText: { fontSize: 13, color: '#8D6E00', lineHeight: 18 },
  emptyTextSpaced: { marginTop: 8 },
  noticeBox: {
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#FFE082',
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
  },
  noticeText: { fontSize: 12, color: '#8D6E00', lineHeight: 17 },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  placeholder: { fontSize: 14, color: '#999', flex: 1 },
  selectedWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  selectedTextWrap: { flex: 1 },
  selectedName: { fontSize: 14, fontWeight: '600', color: '#1A1A1A', flexShrink: 1 },
  selectedSub: { fontSize: 12, color: '#666', marginTop: 2 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EEF0FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#5B67CA', fontWeight: 'bold' },
  clearBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 12,
    paddingHorizontal: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  clearText: { fontSize: 12, color: '#C62828' },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1A1A' },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 6,
    marginBottom: 8,
  },
  invitePrefix: { fontSize: 14, color: '#666' },
  inviteInput: { flex: 1, fontSize: 14, color: '#1A1A1A', minHeight: 32 },
  inviteBtn: {
    minHeight: 44,
    minWidth: 76,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: AppColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteBtnDisabled: { opacity: 0.5 },
  inviteBtnText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  inviteNotice: { fontSize: 12, color: '#2E7D32', marginBottom: 8, lineHeight: 17 },
  inviteNoticeError: { color: '#C62828' },
  inviteStateWrap: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingTop: 12 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A8F9E',
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: 4,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    minHeight: 44,
  },
  reinviteBtn: {
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reinviteText: { fontSize: 12, color: AppColors.primary, fontWeight: '600' },
  stateFootnote: { fontSize: 11, color: '#8A8F9E', marginTop: 8, lineHeight: 16 },
  // RN's ScrollView defaults to flexGrow/flexShrink 1, so a horizontal one in a
  // column gets squashed by the sibling list once modalContent hits maxHeight.
  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: { gap: 8, paddingBottom: 12, paddingRight: 4 },
  filterChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFF',
  },
  filterChipActive: { backgroundColor: '#EEF0FF', borderColor: '#5B67CA' },
  filterChipText: { fontSize: 13, color: '#666' },
  filterChipTextActive: { color: '#5B67CA', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    gap: 10,
    borderRadius: 12,
    minHeight: 44,
  },
  rowActive: { backgroundColor: '#EEF0FF' },
  rowDisabled: { opacity: 0.55 },
  rowTextWrap: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowName: { fontSize: 14, fontWeight: '600', color: '#1A1A1A', flexShrink: 1 },
  rowSub: { fontSize: 12, color: '#666', marginTop: 2 },
  primeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#FFCC80',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  primeBadgeText: { fontSize: 10, fontWeight: '700', color: '#B26A00', letterSpacing: 0.4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  chip: {
    backgroundColor: '#F2F3F7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipMatch: { backgroundColor: '#EEF0FF' },
  chipText: { fontSize: 11, color: '#5A5F73' },
  chipMatchText: { color: '#5B67CA', fontWeight: '600' },
  investigatorOnly: { fontSize: 11, color: '#8A8F9E', marginTop: 4, fontStyle: 'italic' },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  blockedText: { fontSize: 11, color: '#C62828', flexShrink: 1 },
  emptySearch: { fontSize: 13, color: '#999', textAlign: 'center', paddingVertical: 24 },
});
