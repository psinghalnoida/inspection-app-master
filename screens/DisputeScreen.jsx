import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '../constants/theme';
import surveyorService from '../lib/surveyorService';
import * as assignerService from '../lib/assignerService';
import socketService from '../lib/socket';
import { useAuth } from '../app/_layout';

export default function DisputeScreen() {
    const router = useRouter();
    const { id } = useLocalSearchParams(); // Survey ID
    const { userRole } = useAuth();
    const isSurveyor = userRole === 'surveyor';

    const [dispute, setDispute] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const flatListRef = useRef(null);

    useEffect(() => {
        fetchDisputeDetails();

        // Socket connection
        const initSocket = async () => {
            const socket = await socketService.connect();
            if (socket && id) {
                console.log('Joining survey room:', id);
                socket.emit('join:survey', Number(id));

                socket.on('dispute:message', (newMessage) => {
                    console.log('New dispute message received:', newMessage);
                    setMessages((prevMessages) => {
                        // Avoid duplicates
                        if (prevMessages.some(m => m.id === newMessage.id)) return prevMessages;
                        return [...prevMessages, newMessage];
                    });
                });
            }
        };

        initSocket();

        // Polling as backup (increased interval)
        const interval = setInterval(fetchDisputeDetails, 10000);

        return () => {
            clearInterval(interval);
            const socket = socketService.getSocket();
            if (socket) {
                socket.off('dispute:message');
                socket.emit('leave:survey', Number(id));
            }
        };
    }, [id]);

    const fetchDisputeDetails = async () => {
        try {
            // Use correct service based on user role
            const data = isSurveyor
                ? await surveyorService.getDispute(id)
                : await assignerService.getDispute(id);
            if (data) {
                setDispute(data);
                setMessages(data.messages || []);
            }
        } catch (error) {
            console.error('Error fetching dispute details:', error);
            // If checking initially, show alert
            if (loading) {
                Alert.alert('Error', 'Failed to load dispute details. It may not exist yet.');
                router.back();
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSendMessage = async () => {
        if (!newMessage.trim() || !dispute) return;

        setSending(true);
        try {
            // Use correct service based on user role
            if (isSurveyor) {
                await surveyorService.sendDisputeMessage(dispute.id, newMessage.trim());
            } else {
                await assignerService.sendDisputeMessage(dispute.id, newMessage.trim());
            }

            // Refresh details to see new message
            setNewMessage('');
            fetchDisputeDetails();
        } catch (error) {
            Alert.alert('Error', error.message || 'Failed to send message');
        } finally {
            setSending(false);
        }
    };

    const formatTime = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const renderMessage = ({ item }) => {
        // Determine if message is from current user based on their role
        const isMyMessage = isSurveyor ? item.sender_type === 'surveyor' : item.sender_type === 'assigner';
        const isAdmin = item.sender_type === 'admin';

        // Get sender label
        const getSenderLabel = () => {
            if (isMyMessage) return 'You';
            if (isAdmin) return 'Admin';
            if (item.sender_type === 'surveyor') return 'Surveyor';
            if (item.sender_type === 'assigner') return 'Assigner';
            return item.sender_type;
        };

        return (
            <View style={[
                styles.messageBubble,
                isMyMessage ? styles.myMessage : (isAdmin ? styles.adminMessage : styles.theirMessage)
            ]}>
                {!isMyMessage && (
                    <Text style={[
                        styles.senderLabel,
                        isAdmin ? styles.adminSenderLabel : styles.theirSenderLabel
                    ]}>
                        {getSenderLabel()}
                    </Text>
                )}
                <Text style={[
                    styles.messageText,
                    isMyMessage ? styles.myMessageText : (isAdmin ? styles.adminMessageText : styles.theirMessageText)
                ]}>
                    {item.message_text}
                </Text>
                <Text style={[
                    styles.messageTime,
                    isMyMessage ? styles.myMessageTime : styles.theirMessageTime
                ]}>
                    {formatTime(item.created_at)}
                </Text>
            </View>
        );
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.centered}>
                <ActivityIndicator size="large" color={AppColors.primary} />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 20}
            >
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.backBtn}
                        onPress={() => router.back()}
                    >
                        <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
                    </TouchableOpacity>
                    <View style={styles.headerInfo}>
                        <Text style={styles.headerTitle}>Dispute #{dispute?.id}</Text>
                        <Text style={styles.headerSubtitle}>Status: {dispute?.status?.replace(/_/g, ' ').toUpperCase()}</Text>
                    </View>
                    {dispute?.status === 'resolved' && (
                        <View style={styles.statusBadge}>
                            <Text style={styles.statusText}>RESOLVED</Text>
                        </View>
                    )}
                </View>

                {/* Messages List */}
                <FlatList
                    ref={flatListRef}
                    data={messages}
                    renderItem={renderMessage}
                    keyExtractor={(item) => item.id?.toString() || Math.random().toString()}
                    contentContainerStyle={styles.messagesList}
                    onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <MaterialIcons name="info-outline" size={64} color="#DDD" />
                            <Text style={styles.emptyText}>No messages yet</Text>
                            <Text style={styles.emptySubtext}>Discuss the dispute here</Text>
                        </View>
                    }
                />

                {/* Input Area */}
                {dispute?.status !== 'resolved' && (
                    <View style={styles.inputContainer}>
                        <TextInput
                            style={styles.textInput}
                            placeholder="Type a message..."
                            placeholderTextColor="#999"
                            value={newMessage}
                            onChangeText={setNewMessage}
                            multiline
                            maxLength={500}
                        />
                        <TouchableOpacity
                            style={[styles.sendBtn, !newMessage.trim() && styles.sendBtnDisabled]}
                            onPress={handleSendMessage}
                            disabled={!newMessage.trim() || sending}
                        >
                            {sending ? (
                                <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                                <MaterialIcons name="send" size={22} color="#FFF" />
                            )}
                        </TouchableOpacity>
                    </View>
                )}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFF',
    },
    flex: {
        flex: 1,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F5F5F5',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        paddingTop: 12,
        paddingBottom: 16,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#EEE',
    },
    backBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
    headerInfo: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    headerSubtitle: {
        fontSize: 12,
        color: '#666',
        marginTop: 2,
    },
    statusBadge: {
        backgroundColor: '#E8F5E9',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    statusText: {
        color: '#2E7D32',
        fontSize: 12,
        fontWeight: 'bold',
    },
    messagesList: {
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#F8F9FA',
    },
    messageBubble: {
        maxWidth: '85%',
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 20,
        marginVertical: 6,
    },
    myMessage: {
        alignSelf: 'flex-end',
        backgroundColor: AppColors.primary,
        borderBottomRightRadius: 6,
        shadowColor: AppColors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
    },
    theirMessage: {
        alignSelf: 'flex-start',
        backgroundColor: '#FFFFFF',
        borderBottomLeftRadius: 6,
        borderWidth: 1,
        borderColor: '#E8E8E8',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 2,
    },
    adminMessage: {
        alignSelf: 'flex-start',
        backgroundColor: '#FFF8E1',
        borderBottomLeftRadius: 6,
        borderWidth: 1,
        borderColor: '#FFE082',
        borderLeftWidth: 4,
        borderLeftColor: '#FF9800',
        shadowColor: '#FF9800',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 2,
    },
    senderLabel: {
        fontSize: 11,
        fontWeight: '700',
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    theirSenderLabel: {
        color: '#888',
    },
    adminSenderLabel: {
        color: '#E65100',
    },
    messageText: {
        fontSize: 15,
        lineHeight: 22,
    },
    myMessageText: {
        color: '#FFF',
    },
    theirMessageText: {
        color: '#2D3436',
    },
    adminMessageText: {
        color: '#33302E',
    },
    messageTime: {
        fontSize: 10,
        marginTop: 6,
        textAlign: 'right',
    },
    myMessageTime: {
        color: 'rgba(255,255,255,0.75)',
    },
    theirMessageTime: {
        color: '#AAA',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 80,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#999',
        marginTop: 16,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#BBB',
        marginTop: 4,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        backgroundColor: '#FFF',
        paddingHorizontal: 12,
        paddingVertical: 10,
        paddingBottom: Platform.OS === 'ios' ? 30 : 10,
        borderTopWidth: 1,
        borderTopColor: '#EEE',
        gap: 10,
    },
    textInput: {
        flex: 1,
        minHeight: 40,
        maxHeight: 100,
        backgroundColor: '#F5F5F5',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 10,
        fontSize: 15,
        color: '#1A1A1A',
    },
    sendBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: AppColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendBtnDisabled: {
        backgroundColor: '#CCC',
    },
});
