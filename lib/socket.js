/**
 * Socket.IO Client Service
 * Real-time communication for live location tracking
 */

import { io } from 'socket.io-client';
import { getAccessToken } from './storage';
import { SOCKET_URL } from '../constants/config';


class SocketService {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.listeners = new Map();
    }

    /**
     * Initialize and connect to Socket.IO server
     */
    async connect() {
        try {
            // If socket exists and is connected, reuse it
            if (this.socket?.connected) {
                console.log('🔌 Socket already connected');
                return this.socket;
            }

            const token = await getAccessToken();
            
            if (!token) {
                console.log('❌ No auth token for socket connection');
                return null;
            }

            // If socket exists but is disconnected, try to reconnect manually
            if (this.socket) {
                console.log('🔌 Socket exists but disconnected, updating token and reconnecting...');
                this.socket.auth = { token }; // Update auth options with fresh token
                this.socket.connect();
                return this.socket;
            }

            if (!SOCKET_URL) {
                console.log('❌ SOCKET_URL not configured');
                return null;
            }

            this.socket = io(SOCKET_URL, {
                auth: { token },
                path: '/backend/socket.io/',
                transports: ['polling', 'websocket'],
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                reconnectionAttempts: this.maxReconnectAttempts,
                timeout: 10000,
            });

            this.setupEventHandlers();

            // Wait for connection or timeout
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.log('⚠️ Socket connection timeout');
                    resolve(this.socket); // Return socket anyway, it might connect later
                }, 5000);

                this.socket.on('connect', () => {
                    clearTimeout(timeout);
                    resolve(this.socket);
                });

                this.socket.on('connect_error', () => {
                    clearTimeout(timeout);
                    resolve(null);
                });
            });
        } catch (error) {
            console.error('❌ Socket connection error:', error);
            return null;
        }
    }

    /**
     * Setup socket event handlers
     */
    setupEventHandlers() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('✅ Socket connected:', this.socket.id);
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });

        this.socket.on('disconnect', (reason) => {
            console.log('❌ Socket disconnected:', reason);
            this.isConnected = false;
        });

        this.socket.on('connect_error', (error) => {
            console.error('❌ Socket connection error:', error.message);
            this.reconnectAttempts++;
        });

        this.socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
        });
    }

    /**
     * Disconnect from socket server
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
            this.listeners.clear();
            console.log('🔌 Socket disconnected');
        }
    }

    /**
     * Join a survey room for real-time updates
     */
    joinSurveyRoom(surveyId) {
        if (!this.socket?.connected) {
            console.log('⚠️ Socket not connected, cannot join room');
            return false;
        }

        this.socket.emit('join:survey', surveyId);
        console.log(`📍 Joining survey room: ${surveyId}`);
        return true;
    }

    /**
     * Leave a survey room
     */
    leaveSurveyRoom(surveyId) {
        if (!this.socket?.connected) return;

        this.socket.emit('leave:survey', surveyId);
        console.log(`📍 Leaving survey room: ${surveyId}`);
    }

    /**
     * Send location update (for surveyors)
     */
    sendLocationUpdate(surveyId, latitude, longitude) {
        if (!this.socket?.connected) {
            console.log('⚠️ Socket not connected, cannot send location');
            return false;
        }

        this.socket.emit('location:update', {
            surveyId,
            latitude,
            longitude,
        });

        console.log(`📍 Socket location sent: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        return true;
    }

    /**
     * Listen for location updates (for assigners)
     */
    onLocationUpdate(callback) {
        if (!this.socket) return () => { };

        const handler = (data) => {
            console.log('📍 Location update received:', data);
            callback(data);
        };

        this.socket.on('location:updated', handler);
        this.listeners.set('location:updated', handler);

        return () => {
            this.socket?.off('location:updated', handler);
            this.listeners.delete('location:updated');
        };
    }

    /**
     * Listen for status updates
     */
    onStatusUpdate(callback) {
        if (!this.socket) return () => { };

        const handler = (data) => {
            console.log('📢 Status update received:', data);
            callback(data);
        };

        this.socket.on('status:updated', handler);
        this.listeners.set('status:updated', handler);

        return () => {
            this.socket?.off('status:updated', handler);
            this.listeners.delete('status:updated');
        };
    }

    /**
     * Listen for survey room join confirmation
     */
    onSurveyJoined(callback) {
        if (!this.socket) return () => { };

        const handler = (data) => {
            console.log('📍 Survey room joined:', data);
            callback(data);
        };

        this.socket.on('survey:joined', handler);

        return () => {
            this.socket?.off('survey:joined', handler);
        };
    }

    /**
     * Send chat message
     */
    sendChatMessage(surveyId, message, senderId, senderName, senderRole) {
        if (!this.socket?.connected) {
            console.log('⚠️ Socket not connected, cannot send chat');
            return false;
        }

        this.socket.emit('chat:send_message', {
            surveyId,
            message,
            senderId,
            senderName,
            senderRole
        });
        return true;
    }

    /**
     * Listen for chat messages
     */
    onChatMessage(callback) {
        if (!this.socket) return () => { };

        const handler = (data) => {
            // console.log('💬 Chat message received:', data);
            callback(data);
        };

        this.socket.on('chat:receive_message', handler);

        return () => {
            this.socket?.off('chat:receive_message', handler);
        };
    }

    /**
     * Notify backend that user is viewing chat (to suppress push notification)
     */
    joinChatView(surveyId) {
        if (!this.socket?.connected) return;
        this.socket.emit('join:chat_view', surveyId);
    }

    /**
     * Notify backend that user left chat view
     */
    leaveChatView(surveyId) {
        if (!this.socket?.connected) return;
        this.socket.emit('leave:chat_view', surveyId);
    }

    /**
     * Listen for new survey request notifications (for surveyors)
     */
    onNewRequest(callback) {
        if (!this.socket) return () => { };

        const handler = (data) => {
            console.log('📲 New request notification received:', data);
            callback(data);
        };

        this.socket.on('notification:new_request', handler);
        this.listeners.set('notification:new_request', handler);

        return () => {
            this.socket?.off('notification:new_request', handler);
            this.listeners.delete('notification:new_request');
        };
    }

    /**
     * Listen for expired broadcast notifications (for surveyors)
     */
    onNotificationExpired(callback) {
        if (!this.socket) return () => { };

        const handler = (data) => {
            console.log('⏰ Notification expired received:', data);
            callback(data);
        };

        this.socket.on('notification:expired', handler);
        this.listeners.set('notification:expired', handler);

        return () => {
            this.socket?.off('notification:expired', handler);
            this.listeners.delete('notification:expired');
        };
    }

    /**
     * Listen for generic new notifications
     */
    onNewNotification(callback) {
        if (!this.socket) return () => { };

        const handler = (data) => {
            console.log('🔔 New notification received:', data);
            callback(data);
        };

        this.socket.on('notification:new', handler);
        this.listeners.set('notification:new', handler);

        return () => {
            this.socket?.off('notification:new', handler);
            this.listeners.delete('notification:new');
        };
    }

    /**
     * Listen for unread count updates
     */
    onUnreadCount(callback) {
        if (!this.socket) return () => { };

        const handler = (data) => {
            // data is { count: 5 }
            console.log('🔢 Unread count update:', data);
            callback(data.count);
        };

        this.socket.on('notification:unread_count', handler);
        this.listeners.set('notification:unread_count', handler);

        return () => {
            this.socket?.off('notification:unread_count', handler);
            this.listeners.delete('notification:unread_count');
        };
    }

    /**
     * Check if socket is connected
     */
    isSocketConnected() {
        return this.socket?.connected || false;
    }

    /**
     * Get socket instance
     */
    getSocket() {
        return this.socket;
    }
}

// Singleton instance
const socketService = new SocketService();

export { socketService };
export default socketService;
