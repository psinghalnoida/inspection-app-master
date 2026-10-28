/**
 * Assigner API service
 */

import api from './api';

// ==================== PROFILE ====================

export const getAssignerProfile = async () => {
    const response = await api.get('/assigner/profile');
    return response.data;
};

export const updateAssignerProfile = async (data) => {
    const response = await api.put('/assigner/profile', data);
    return response.data;
};

export const changePassword = async (currentPassword, newPassword) => {
    const response = await api.put('/assigner/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
    });
    return response;
};

// ==================== SURVEYS ====================

export const listSurveys = async (params = {}) => {
    const response = await api.get('/assigner/surveys', params);
    return response;
};

export const getSurvey = async (id) => {
    const response = await api.get(`/assigner/surveys/${id}`);
    return response.data;
};

export const getSurveyDetail = async (id) => {
    const response = await api.get(`/assigner/surveys/${id}`);
    return response;
};

export const createSurvey = async (formData) => {
    const response = await api.upload('/assigner/surveys', formData);
    return response.data;
};

export const getSurveyStatusHistory = async (id) => {
    const response = await api.get(`/assigner/surveys/${id}/status-history`);
    return response.data;
};

export const getSurveyPhotos = async (id) => {
    const response = await api.get(`/assigner/surveys/${id}/photos`);
    return response.data;
};

export const getSessionNotes = async (id) => {
    const response = await api.get(`/assigner/surveys/${id}/notes`);
    return response.data;
};

export const getSurveyDocuments = async (id) => {
    const response = await api.get(`/assigner/surveys/${id}/documents`);
    return response.data;
};

export const getSurveyReports = async (id) => {
    const response = await api.get(`/assigner/surveys/${id}/reports`);
    return response.data;
};

export const acceptReport = async (surveyId, reportId) => {
    const response = await api.put(`/assigner/surveys/${surveyId}/reports/${reportId}/accept`, {});
    return response;
};

export const rejectReport = async (surveyId, reportId, reason) => {
    const response = await api.put(`/assigner/surveys/${surveyId}/reports/${reportId}/reject`, {
        rejection_reason: reason,
    });
    return response;
};

export const getSurveyorLocation = async (surveyId) => {
    const response = await api.get(`/assigner/surveys/${surveyId}/surveyor-location`);
    return response.data;
};

export const uploadSurveyDocuments = async (surveyId, formData) => {
    const response = await api.upload(`/assigner/surveys/${surveyId}/documents`, formData);
    return response.data;
};

export const deleteSurveyDocument = async (surveyId, docId) => {
    const response = await api.delete(`/assigner/surveys/${surveyId}/documents/${docId}`);
    return response;
};

export const sendLocationSMS = async (surveyId) => {
    const response = await api.post(`/assigner/surveys/${surveyId}/send-location-sms`, {});
    return response;
};

export const markSatisfied = async (surveyId) => {
    const response = await api.post(`/assigner/surveys/${surveyId}/satisfied`, {});
    return response;
};

export const escalateSurvey = async (surveyId) => {
    const response = await api.post(`/assigner/surveys/${surveyId}/escalate`, {});
    return response;
};

export const getBroadcastStatus = async (surveyId) => {
    const response = await api.get(`/assigner/surveys/${surveyId}/broadcast-status`);
    return response;
};

// ==================== PAYMENT ====================

export const calculatePrice = async (surveyId) => {
    const response = await api.post(`/assigner/surveys/${surveyId}/calculate-price`, {});
    return response.data;
};

export const applyCoupon = async (surveyId, couponCode) => {
    console.log('applyCoupon called:', surveyId, couponCode);
    const response = await api.post(`/assigner/surveys/${surveyId}/apply-coupon`, {
        coupon_code: couponCode,
    });
    console.log('applyCoupon response:', response);
    return response;
};

export const initiatePayment = async (surveyId, payload = {}) => {
    const response = await api.post(`/assigner/surveys/${surveyId}/initiate-payment`, payload);
    return response.data;
};

export const verifyPayment = async (surveyId, paymentData) => {
    const response = await api.post(`/assigner/surveys/${surveyId}/verify-payment`, paymentData);
    return response.data;
};

export const getPaymentHistory = async (params = {}) => {
    const response = await api.get('/assigner/payments', params);
    return response;
};

// v2 §3 — the admin's itemised final invoice for one survey.
// Returns { bill, billing_state, message }. Drafts are never returned.
export const getSurveyBill = async (surveyId) => {
    const response = await api.get(`/assigner/surveys/${surveyId}/bill`);
    return response.data;
};

// v2 §4 — start a SabPaisa payment for the invoice balance. Returns the encrypted
// payload the WebView POSTs to the gateway; the bill is settled server-side by the
// shared SabPaisa callback (no client-trusted verify step). Same shape as the advance.
export const payBalance = async (surveyId) => {
    const response = await api.post(`/assigner/surveys/${surveyId}/pay-balance`, {});
    return response.data;
};

// ==================== CHAT ====================

export const getChatMessages = async (surveyId) => {
    const response = await api.get(`/assigner/surveys/${surveyId}/chat`);
    return response.data;
};

export const sendChatMessage = async (surveyId, message) => {
    const response = await api.post(`/assigner/surveys/${surveyId}/chat`, { message });
    return response.data;
};

// ==================== DISPUTES ====================

export const getDispute = async (surveyId) => {
    const response = await api.get(`/assigner/surveys/${surveyId}/dispute`);
    return response.data;
};

export const sendDisputeMessage = async (disputeId, messageText) => {
    const response = await api.post(`/assigner/disputes/${disputeId}/messages`, {
        message_text: messageText,
    });
    return response.data;
};

// ==================== SURVEYOR LOOKUP ====================

export const findSurveyorByPhone = async (phone) => {
    try {
        const response = await api.get(`/assigner/surveyors/by-phone?phone=${phone}`);
        return response; // Return full response including success status
    } catch (error) {
        console.log('Surveyor lookup error:', error.message);
        return { success: false, message: error.message };
    }
};
