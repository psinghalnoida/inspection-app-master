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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppColors } from '../constants/theme';
import { getChatMessages, sendChatMessage } from '../lib/assignerService';
import surveyorService from '../lib/surveyorService';
import { useAuth } from '../app/_layout';

export default function ChatScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { surveyId } = useLocalSearchParams();
    const { userRole } = useAuth();
    const isSurveyor = userRole === 'surveyor';

    const [messages, setMessages] = useState([]);
    const [survey, setSurvey] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const flatListRef = useRef(null);

    useEffect(() => {
        fetchSurveyDetails();
        fetchMessages();
        // Polling for new messages every 5 seconds
        const interval = setInterval(fetchMessages, 2000);
        return () => clearInterval(interval);
    }, [surveyId]);

    const fetchSurveyDetails = async () => {
        try {
            let surveyData;
            if (isSurveyor) {
                surveyData = await surveyorService.getSurveyDetail(surveyId);
            } else {
                const { getSurvey } = await import('../lib/assignerService');
                surveyData = await getSurvey(surveyId);
            }
            if (surveyData) {
                setSurvey(surveyData);
                console.log('Survey data for chat:', surveyData);
            }
        } catch (error) {
            console.error('Error fetching survey details:', error);
        }
    };

    const getChatPartnerName = () => {
        if (!survey) return 'Chat Partner';

        if (isSurveyor) {
            // Surveyor chatting with assigner
            const name = survey.assigner_company || survey.assigner_contact ||
                survey.assigner_name || survey.company_name || 'Assigner';
            return name;
        } else {
            // Assigner chatting with surveyor
            // Handle case where surveyor_name might be null or "Allocated Surveyor" (blind assignment)
            const name = survey.surveyor_name || survey.full_name || 'Surveyor';
            return name === 'Allocated Surveyor' ? name : name;
        }
    };

    const fetchMessages = async () => {
        try {
            const response = isSurveyor
                ? await surveyorService.getChatMessages(surveyId)
                : await getChatMessages(surveyId);
            setMessages(response || []);
        } catch (error) {
            console.error('Error fetching messages:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSendMessage = async () => {
        if (!newMessage.trim()) return;

        setSending(true);
        try {
            const response = isSurveyor
                ? await surveyorService.sendChatMessage(surveyId, newMessage.trim())
                : await sendChatMessage(surveyId, newMessage.trim());

            // Add the new message to the list optimistically or wait for refresh
            // Let's assume response.data is the new message or response is the message for assigner
            const sentMsg = response.data || response;
            if (sentMsg) {
                setMessages(prev => [...prev, sentMsg]);
            }

            setNewMessage('');
            fetchMessages();
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
        const isMyMessage = isSurveyor
            ? item.sender_type === 'surveyor'
            : item.sender_type === 'assigner';

        return (
            <View style={[
                styles.messageBubble,
                isMyMessage ? styles.myMessage : styles.theirMessage
            ]}>
                <Text style={[
                    styles.messageText,
                    isMyMessage ? styles.myMessageText : styles.theirMessageText
                ]}>
                    {item.message_text}
                </Text>
                <Text style={[
                    styles.messageTime,
                    isMyMessage ? styles.myMessageTime : styles.theirMessageTime
                ]}>
                    {formatTime(item.sent_at || item.created_at)}
                </Text>
            </View>
        );
    };

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color={AppColors.primary} />
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 20}
        >
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                    <TouchableOpacity
                        style={styles.backBtn}
                        onPress={() => router.back()}
                    >
                        <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
                    </TouchableOpacity>
                    <View style={styles.avatarContainer}>
                        <Text style={styles.avatarText}>{getChatPartnerName().charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.headerInfo}>
                        <Text style={styles.headerTitle}>{getChatPartnerName()}</Text>
                        <Text style={styles.headerSubtitle}>{isSurveyor ? 'Assigner' : 'Surveyor'} • Survey #{surveyId}</Text>
                    </View>
                </View>

                {/* Messages List */}
                <FlatList
                    ref={flatListRef}
                    data={messages}
                    renderItem={renderMessage}
                    keyExtractor={(item) => item.id?.toString() || Math.random().toString()}
                    contentContainerStyle={styles.messagesList}
                    inverted={false}
                    onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <MaterialIcons name="chat-bubble-outline" size={64} color="#DDD" />
                            <Text style={styles.emptyText}>No messages yet</Text>
                            <Text style={styles.emptySubtext}>Start the conversation!</Text>
                        </View>
                    }
                />

                {/* Input Area */}
                <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
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
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F5F5',
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
    avatarContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: AppColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    avatarText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
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
    messagesList: {
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    messageBubble: {
        maxWidth: '80%',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 18,
        marginVertical: 4,
    },
    myMessage: {
        alignSelf: 'flex-end',
        backgroundColor: AppColors.primary,
        borderBottomRightRadius: 4,
    },
    theirMessage: {
        alignSelf: 'flex-start',
        backgroundColor: '#FFF',
        borderBottomLeftRadius: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    messageText: {
        fontSize: 15,
        lineHeight: 20,
    },
    myMessageText: {
        color: '#FFF',
    },
    theirMessageText: {
        color: '#1A1A1A',
    },
    messageTime: {
        fontSize: 11,
        marginTop: 4,
        textAlign: 'right',
    },
    myMessageTime: {
        color: 'rgba(255,255,255,0.7)',
    },
    theirMessageTime: {
        color: '#999',
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
        paddingTop: 10,
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
