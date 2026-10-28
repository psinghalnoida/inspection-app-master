/**
 * Authentication service for ClaimsMitra
 */

import api from './api';
import { saveTokens, saveUser, saveUserRole, removeTokens, getUser, getUserRole } from './storage';

// Assigner Login
export const loginAssigner = async (phone, password) => {
    const response = await api.post('/auth/assigner/login', { phone, password });

    if (response.success && response.data) {
        const { user, tokens } = response.data;
        await saveTokens(tokens.accessToken, tokens.refreshToken);
        await saveUser(user);
        await saveUserRole('assigner');
        return { user, tokens };
    }

    throw new Error(response.message || 'Login failed');
};

// Surveyor Login
export const loginSurveyor = async (phone, password) => {
    const response = await api.post('/auth/surveyor/login', { phone, password });

    if (response.success && response.data) {
        const { user, tokens } = response.data;
        await saveTokens(tokens.accessToken, tokens.refreshToken);
        await saveUser(user);
        await saveUserRole('surveyor');
        return { user, tokens };
    }

    throw new Error(response.message || 'Login failed');
};

// Surveyor Login with PIN
export const loginSurveyorWithPIN = async (phone, pin) => {
    const response = await api.post('/auth/surveyor/login-pin', { phone, pin });

    if (response.success && response.data) {
        const { user, tokens } = response.data;
        await saveTokens(tokens.accessToken, tokens.refreshToken);
        await saveUser(user);
        await saveUserRole('surveyor');
        return { user, tokens };
    }

    throw new Error(response.message || 'PIN login failed');
};

// Register Surveyor
export const registerSurveyor = async (formData) => {
    const response = await api.upload('/auth/surveyor/register', formData);

    if (response.success && response.data) {
        const { user, tokens } = response.data;
        await saveTokens(tokens.accessToken, tokens.refreshToken);
        await saveUser(user);
        await saveUserRole('surveyor');
        return { user, tokens };
    }

    throw new Error(response.message || 'Registration failed');
};

// Logout
export const logout = async () => {
    try {
        const role = await getUserRole();
        if (role === 'assigner') {
            await api.post('/auth/assigner/logout', {});
        } else if (role === 'surveyor') {
            await api.post('/auth/surveyor/logout', {});
        }
    } catch (error) {
        // Ignore logout API errors
        console.log('Logout API error (ignored):', error.message);
    }

    await removeTokens();
};

// Get current user
export const getCurrentUser = async () => {
    return await getUser();
};

// Get current role
export const getCurrentRole = async () => {
    return await getUserRole();
};

// Check authentication status
export { isAuthenticated } from './storage';
