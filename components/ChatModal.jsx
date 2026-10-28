import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import socketService from '../lib/socket';
import { getChatMessages } from '../lib/assignerService';
import surveyorService from '../lib/surveyorService';
import { getUser } from '../lib/storage';
import { AppColors } from '../constants/theme';

export default function ChatModal({ visible, onClose, surveyId, isSurveyor, survey, userRole }) {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [currentUser, setCurrentUser] = useState(null);
    const flatListRef = useRef(null);
    const insets = useSafeAreaInsets();
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const keyboardPadding = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            getUser().then(u => setCurrentUser(u));
        }
    }, [visible]);

    // iOS: KeyboardAvoidingView is unreliable inside a pageSheet Modal — the
    // keyboard frame is reported in full-screen coordinates while the sheet is
    // offset, so the computed overlap is wrong and the input stays hidden.
    // Drive the bottom padding manually from keyboard events instead.
    useEffect(() => {
        if (Platform.OS !== 'ios') return;
        const onShow = (e) => {
            setKeyboardVisible(true);
            Animated.timing(keyboardPadding, {
                toValue: e.endCoordinates?.height ?? 0,
                duration: e.duration || 250,
                useNativeDriver: false,
            }).start();
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 60);
        };
        const onHide = (e) => {
            setKeyboardVisible(false);
            Animated.timing(keyboardPadding, {
                toValue: 0,
                duration: e.duration || 200,
                useNativeDriver: false,
            }).start();
        };
        const showSub = Keyboard.addListener('keyboardWillShow', onShow);
        const hideSub = Keyboard.addListener('keyboardWillHide', onHide);
        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, [keyboardPadding]);

    // Chat Socket Logic
    useEffect(() => {
        let unsubscribe = () => { };

        if (visible && surveyId && currentUser) {
            const setupChat = async () => {
                // Fetch History
                try {
                    const fetchMessages = isSurveyor ? surveyorService.getChatMessages : getChatMessages;
                    const res = await fetchMessages(surveyId);
                    const history = (res.data || res).map(m => ({
                        _id: m.id,
                        text: m.message_text,
                        senderId: m.sender_id,
                        senderName: (isSurveyor ? m.sender_type === 'surveyor' : m.sender_type === 'assigner') ? (currentUser?.name || 'Me') : (isSurveyor ? (survey?.assigner_company || 'Assigner') : (survey?.surveyor_name || 'Surveyor')),
                        createdAt: m.sent_at,
                        senderRole: m.sender_type
                    }));
                    setMessages(history);
                    setTimeout(() => {
                        flatListRef.current?.scrollToEnd({ animated: false });
                    }, 100);
                } catch (err) {
                    console.error('Failed to load chat history:', err);
                }

                let socket = socketService.getSocket();
                if (!socket || !socket.connected) {
                    socket = await socketService.connect();
                }

                if (socket) {
                    socketService.joinSurveyRoom(surveyId);
                    socketService.joinChatView(surveyId);
                    unsubscribe = socketService.onChatMessage((data) => {
                        setMessages(prev => {
                            if (prev.some(m => m._id === data._id)) return prev;
                            return [...prev, data];
                        });
                        setTimeout(() => {
                            flatListRef.current?.scrollToEnd({ animated: true });
                        }, 100);
                    });
                }
            };
            setupChat();
        }

        return () => {
            if (surveyId) socketService.leaveChatView(surveyId);
            unsubscribe();
        };
    }, [visible, surveyId, currentUser]);

    const handleSendMessage = () => {
        if (!newMessage.trim() || !currentUser) return;

        const success = socketService.sendChatMessage(
            surveyId,
            newMessage.trim(),
            currentUser.id,
            currentUser.name,
            userRole
        );

        if (success) {
            setNewMessage('');
        } else {
            Alert.alert('Error', 'Connection lost. Please try again.');
        }
    };

    const chatBody = (
        <>
            {/* Chat Header */}
            <View style={styles.chatHeader}>
                <TouchableOpacity onPress={onClose} style={styles.chatCloseBtn}>
                    <MaterialIcons name="close" size={24} color="#333" />
                </TouchableOpacity>
                <View style={{ alignItems: 'center' }}>
                    <Text style={styles.chatTitle}>Chat with {isSurveyor ? 'Assigner' : 'Surveyor'}</Text>
                    <Text style={styles.chatSubtitle}>#{survey?.laid || surveyId}</Text>
                </View>
                <View style={{ width: 40 }} />
            </View>

            {/* Messages List */}
            <FlatList
                ref={flatListRef}
                style={{ flex: 1 }}
                data={messages}
                keyExtractor={item => item._id?.toString() || Math.random().toString()}
                contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                    const isMe = isSurveyor ? item.senderRole === 'surveyor' : item.senderRole === 'assigner';
                    return (
                        <View style={[
                            styles.messageBubble,
                            isMe ? styles.messageBubbleMe : styles.messageBubbleOther
                        ]}>
                            {!isMe && <Text style={styles.messageSender}>{item.senderName}</Text>}
                            <Text style={[
                                styles.messageText,
                                isMe ? styles.messageTextMe : styles.messageTextOther
                            ]}>{item.text}</Text>
                            <Text style={[
                                styles.messageTime,
                                isMe ? styles.messageTimeMe : styles.messageTimeOther
                            ]}>
                                {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                        </View>
                    );
                }}
                onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
            />

            {/* Input Area */}
            <View style={[styles.chatInputContainer, { paddingBottom: keyboardVisible ? 12 : insets.bottom + 12 }]}>
                <TextInput
                    style={styles.chatInput}
                    placeholder="Type a message..."
                    value={newMessage}
                    onChangeText={setNewMessage}
                    multiline
                />
                <TouchableOpacity
                    style={[styles.chatSendBtn, !newMessage.trim() && { opacity: 0.5 }]}
                    onPress={handleSendMessage}
                    disabled={!newMessage.trim()}
                >
                    <MaterialIcons name="send" size={24} color="#FFF" />
                </TouchableOpacity>
            </View>
        </>
    );

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <SafeAreaProvider>
                <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F5F7' }} edges={['top']}>
                    {Platform.OS === 'ios' ? (
                        <Animated.View style={{ flex: 1, paddingBottom: keyboardPadding }}>
                            {chatBody}
                        </Animated.View>
                    ) : (
                        <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
                            {chatBody}
                        </KeyboardAvoidingView>
                    )}
                </SafeAreaView>
            </SafeAreaProvider>
        </Modal>
    );
}

const styles = StyleSheet.create({
    chatHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#EEE',
        marginTop: Platform.OS === 'ios' ? 0 : 0, // Adjusted as it's in a modal now
    },
    chatTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
    },
    chatSubtitle: {
        fontSize: 12,
        color: '#666',
        textAlign: 'center',
    },
    chatCloseBtn: {
        padding: 8,
    },
    messageBubble: {
        maxWidth: '80%',
        padding: 12,
        borderRadius: 16,
        marginBottom: 8,
    },
    messageBubbleMe: {
        alignSelf: 'flex-end',
        backgroundColor: AppColors.primary,
        borderBottomRightRadius: 4,
    },
    messageBubbleOther: {
        alignSelf: 'flex-start',
        backgroundColor: '#FFF',
        borderBottomLeftRadius: 4,
    },
    messageSender: {
        fontSize: 10,
        color: '#999',
        marginBottom: 4,
        fontWeight: '600',
    },
    messageText: {
        fontSize: 14,
    },
    messageTextMe: {
        color: '#FFF',
    },
    messageTextOther: {
        color: '#333',
    },
    messageTime: {
        fontSize: 10,
        marginTop: 4,
        alignSelf: 'flex-end',
    },
    messageTimeMe: {
        color: 'rgba(255,255,255,0.7)',
    },
    messageTimeOther: {
        color: '#999',
    },
    chatInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#FFF',
        borderTopWidth: 1,
        borderTopColor: '#EEE',
    },
    chatInput: {
        flex: 1,
        backgroundColor: '#F5F5F7',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minHeight: 40,
        maxHeight: 100,
        marginRight: 10,
        fontSize: 14,
    },
    chatSendBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: AppColors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 2,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.20,
        shadowRadius: 1.41,
    },
});
