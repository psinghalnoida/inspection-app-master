/**
 * API Client for ClaimsMitra Backend
 * With automatic token refresh and logout handling
 */

import { getAccessToken, getRefreshToken, removeTokens, saveTokens, getUserRole } from './storage';
import { API_BASE_URL } from '../constants/config';


// Flag to prevent multiple refresh attempts at once
let isRefreshing = false;
let refreshPromise = null;

class ApiClient {
    constructor() {
        this.baseUrl = API_BASE_URL;
    }

    /**
     * Attempt to refresh the access token using the refresh token
     */
    async refreshAccessToken() {
        // If already refreshing, wait for that to complete
        if (isRefreshing && refreshPromise) {
            return refreshPromise;
        }

        isRefreshing = true;
        refreshPromise = this._doRefresh();

        try {
            return await refreshPromise;
        } finally {
            isRefreshing = false;
            refreshPromise = null;
        }
    }

    async _doRefresh() {
        const refreshToken = await getRefreshToken();
        const userRole = await getUserRole();

        if (!refreshToken || !userRole) {
            console.log('❌ No refresh token or role found');
            return false;
        }

        // Map role to correct endpoint
        const refreshEndpoints = {
            assigner: '/auth/assigner/refresh-token',
            surveyor: '/auth/surveyor/refresh-token',
            admin: '/auth/admin/refresh-token',
        };

        const endpoint = refreshEndpoints[userRole];
        if (!endpoint) {
            console.log('❌ Unknown user role:', userRole);
            return false;
        }

        try {
            console.log('🔄 Refreshing token for role:', userRole);
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken }),
            });

            const data = await response.json();

            if (response.ok && data.success && data.data?.tokens) {
                const { accessToken, refreshToken: newRefreshToken } = data.data.tokens;
                await saveTokens(accessToken, newRefreshToken);
                console.log('✅ Token refreshed successfully');
                return true;
            } else {
                console.log('❌ Token refresh failed:', data.message || 'Invalid response');
                return false;
            }
        } catch (error) {
            console.error('❌ Token refresh internal error:', error.message);
            return false;
        }
    }

    /**
     * Handle logout - clear tokens
     * Note: Navigation is handled by the auth context in _layout.jsx
     */
    async handleLogout() {
        console.log('🚪 ApiClient: Initiating logout/token cleanup...');
        try {
            await removeTokens();
            console.log('✅ ApiClient: Tokens cleared from storage');
        } catch (error) {
            console.error('❌ ApiClient: Error clearing tokens:', error);
        }
    }

    async request(endpoint, options = {}, isRetry = false) {
        const url = `${this.baseUrl}${endpoint}`;
        const token = await getAccessToken();
        const isAuthEndpoint = endpoint.includes('/auth/');

        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...(token && { Authorization: `Bearer ${token}` }),
                ...options.headers,
            },
            ...options,
        };

        try {
            console.log(`📡 API Request: ${options.method || 'GET'} ${endpoint}`);
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                // Handle 401 - Unauthorized (skip refresh for auth endpoints like login)
                if (response.status === 401 && !isRetry && !isAuthEndpoint) {
                    console.log('⚠️ Token expired, attempting refresh...');
                    const refreshed = await this.refreshAccessToken();

                    if (refreshed) {
                        // Retry the original request with new token
                        console.log('🔁 Retrying request with new token');
                        return this.request(endpoint, options, true);
                    } else {
                        // Refresh failed, logout user
                        await this.handleLogout();
                        throw new ApiError('Session expired. Please login again.', 401, data);
                    }
                }
                throw new ApiError(data.message || 'Request failed', response.status, data);
            }

            return data;
        } catch (err) {
            if (err instanceof ApiError) throw err;
            console.error('API Error:', err.message);
            throw new ApiError(err.message || 'Network error', 0, null);
        }
    }

    // HTTP Methods
    get(endpoint, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${endpoint}?${queryString}` : endpoint;
        return this.request(url, { method: 'GET' });
    }

    post(endpoint, data, options = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
            ...options,
        });
    }

    put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }

    // File upload with token refresh support
    async upload(endpoint, formData, isRetry = false, method = 'POST') {
        const url = `${this.baseUrl}${endpoint}`;
        const token = await getAccessToken();
        const isAuthEndpoint = endpoint.includes('/auth/');

        const config = {
            method,
            headers: {
                ...(token && { Authorization: `Bearer ${token}` }),
                // Don't set Content-Type for FormData - fetch will set it automatically
            },
            body: formData,
        };

        try {
            console.log('📤 API Upload:', endpoint);
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                // Handle 401 - Unauthorized (skip refresh for auth endpoints)
                if (response.status === 401 && !isRetry && !isAuthEndpoint) {
                    console.log('⚠️ Token expired during upload, attempting refresh...');
                    const refreshed = await this.refreshAccessToken();

                    if (refreshed) {
                        console.log('🔁 Retrying upload with new token');
                        return this.upload(endpoint, formData, true, method);
                    } else {
                        await this.handleLogout();
                        throw new ApiError('Session expired. Please login again.', 401, data);
                    }
                }

                // Log validation errors in detail
                if (data.errors) {
                    console.error('❌ Validation Errors:', JSON.stringify(data.errors, null, 2));
                }
                throw new ApiError(data.message || 'Upload failed', response.status, data);
            }

            return data;
        } catch (err) {
            if (err instanceof ApiError) throw err;
            throw new ApiError(err.message || 'Upload failed', 0, null);
        }
    }
}

class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.status = status;
        this.data = data;
        this.name = 'ApiError';
    }
}

/**
 * Turn an ApiError into an { title, message } pair ready for Alert.alert.
 *
 * Handles the direct-assign rejections (the server message is the useful one,
 * so it is shown verbatim) and both shapes of `errors`: the express-validator
 * array and the object form { code, ... }.
 */
export function describeApiError(error, fallback = 'Something went wrong. Please try again.') {
    const data = error?.data || {};
    const errors = data.errors;
    const code = errors?.code || data.code;
    const requiredCategory = errors?.required_category || data.required_category;

    // v2 §2: team membership is consent-based, so a surveyor who has not
    // accepted the invite cannot be direct-assigned yet.
    if (code === 'TEAM_INVITE_NOT_ACCEPTED' || code === 'SURVEYOR_NOT_IN_TEAM') {
        const inviteStatus = data.data?.invite_status || errors?.invite_status;
        return {
            // SURVEYOR_NOT_IN_TEAM means no invite exists at all — do not claim
            // there is one waiting for an answer.
            title: code === 'SURVEYOR_NOT_IN_TEAM'
                ? 'Surveyor Not In Your Team'
                : inviteStatus === 'declined' ? 'Invitation Declined' : 'Invitation Not Accepted Yet',
            message: data.message || error?.message || fallback,
        };
    }

    if (code === 'SURVEYOR_CATEGORY_MISMATCH' || requiredCategory) {
        return {
            title: 'Surveyor Not Eligible',
            message: data.message || error?.message || fallback,
        };
    }

    if (Array.isArray(errors) && errors.length > 0) {
        return {
            title: 'Validation Error',
            message: errors
                .map((e) => (e.field ? `• ${e.field}: ${e.message}` : `• ${e.message}`))
                .join('\n'),
        };
    }

    return { title: 'Error', message: data.message || error?.message || fallback };
}

// Singleton instance
const api = new ApiClient();

export { api, ApiError };
export default api;
