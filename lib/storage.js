/**
 * AsyncStorage utilities for auth tokens and user data
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
    ACCESS_TOKEN: 'accessToken',
    REFRESH_TOKEN: 'refreshToken',
    USER: 'user',
    USER_ROLE: 'userRole',
};

// Token management
export const saveTokens = async (accessToken, refreshToken) => {
    try {
        await AsyncStorage.multiSet([
            [KEYS.ACCESS_TOKEN, accessToken],
            [KEYS.REFRESH_TOKEN, refreshToken],
        ]);
    } catch (error) {
        console.error('Error saving tokens:', error);
    }
};

export const getAccessToken = async () => {
    try {
        return await AsyncStorage.getItem(KEYS.ACCESS_TOKEN);
    } catch (error) {
        console.error('Error getting access token:', error);
        return null;
    }
};

export const getRefreshToken = async () => {
    try {
        return await AsyncStorage.getItem(KEYS.REFRESH_TOKEN);
    } catch (error) {
        console.error('Error getting refresh token:', error);
        return null;
    }
};

export const removeTokens = async () => {
    try {
        await AsyncStorage.multiRemove([
            KEYS.ACCESS_TOKEN,
            KEYS.REFRESH_TOKEN,
            KEYS.USER,
            KEYS.USER_ROLE,
        ]);
    } catch (error) {
        console.error('Error removing tokens:', error);
    }
};

// User management
export const saveUser = async (user) => {
    try {
        await AsyncStorage.setItem(KEYS.USER, JSON.stringify(user));
    } catch (error) {
        console.error('Error saving user:', error);
    }
};

export const getUser = async () => {
    try {
        const userStr = await AsyncStorage.getItem(KEYS.USER);
        return userStr ? JSON.parse(userStr) : null;
    } catch (error) {
        console.error('Error getting user:', error);
        return null;
    }
};

// Role management
export const saveUserRole = async (role) => {
    try {
        await AsyncStorage.setItem(KEYS.USER_ROLE, role);
    } catch (error) {
        console.error('Error saving user role:', error);
    }
};

export const getUserRole = async () => {
    try {
        return await AsyncStorage.getItem(KEYS.USER_ROLE);
    } catch (error) {
        console.error('Error getting user role:', error);
        return null;
    }
};

// Check if user is logged in
export const isAuthenticated = async () => {
    const token = await getAccessToken();
    return !!token;
};
