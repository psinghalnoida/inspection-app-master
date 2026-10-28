/**
 * Payment WebView Screen
 * Displays SabPaisa payment page in a WebView
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { AppColors } from '../constants/theme';
import { verifyPayment } from '../lib/assignerService';

export default function PaymentWebViewScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const webViewRef = useRef(null);
    const params = useLocalSearchParams();

    const { payment_url, payment_id, survey_id, amount, encData, clientCode, spURL } = params;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [canGoBack, setCanGoBack] = useState(false);
    const isHandlingPayment = useRef(false);

    // Construct HTML for POST form submission
    const getPaymentHtml = () => {
        if (encData && clientCode && spURL) {
            return `
                <html>
                <body onload="document.getElementById('paymentForm').submit()">
                    <div style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:-apple-system, system-ui, sans-serif;flex-direction:column;">
                        <div style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;"></div>
                        <p style="margin-top:20px;color:#666;">Redirecting to SabPaisa...</p>
                    </div>
                    <style>
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                    <form id="paymentForm" action="${spURL}" method="POST">
                        <input type="hidden" name="encData" value="${encData}">
                        <input type="hidden" name="clientCode" value="${clientCode}">
                    </form>
                </body>
                </html>
            `;
        }
        return null;
    };

    const paymentHtml = getPaymentHtml();

    // Detect callback URLs (deep link or web callback) and route to success/failure
    // handlers. Lives in its own helper so both onShouldStartLoadWithRequest and
    // onNavigationStateChange can call it; the former is what actually blocks the
    // load on Android/iOS.
    const tryHandleCallback = useCallback((url) => {
        if (!url) return false;
        const isCallback = url.startsWith('claimsmitra://') || url.includes('/payment/callback');
        if (!isCallback) return false;

        try {
            const urlToParse = url.startsWith('claimsmitra://')
                ? url.replace('claimsmitra://', 'https://dummy.com/')
                : url;
            const urlObj = new URL(urlToParse);

            const status = urlObj.searchParams.get('status');
            const paymentIdFromCallback = urlObj.searchParams.get('payment_id');
            const surveyIdFromCallback = urlObj.searchParams.get('survey_id');
            const message = urlObj.searchParams.get('message');

            if (status === 'success') {
                if (!isHandlingPayment.current) {
                    isHandlingPayment.current = true;
                    handlePaymentSuccess(paymentIdFromCallback, surveyIdFromCallback);
                }
            } else if (!isHandlingPayment.current) {
                handlePaymentFailure(message || 'Payment was not completed');
            }
        } catch (e) {
            console.error('Error parsing callback URL:', e);
        }
        return true;
    }, []);

    // Block the WebView from actually navigating to the callback URL. If we let
    // the web callback URL load, the web frontend redirects to /login (no auth
    // in WebView) and the user is left staring at a login form instead of going
    // back to their survey.
    const handleShouldStartLoadWithRequest = useCallback((request) => {
        return !tryHandleCallback(request.url);
    }, [tryHandleCallback]);

    // onNavigationStateChange remains for header state (canGoBack, loading) and
    // as a backstop on platforms where onShouldStartLoadWithRequest doesn't fire
    // for every redirect (e.g. server-issued 302 to a deep link).
    const handleNavigationStateChange = useCallback((navState) => {
        setCanGoBack(navState.canGoBack);
        setLoading(navState.loading);
        tryHandleCallback(navState.url);
    }, [tryHandleCallback]);

    // Confirm payment with backend, then navigate back. SabPaisa sometimes
    // redirects directly to the claimsmitra:// deep link without POSTing to our
    // server callback, which leaves payments.status='pending' and
    // surveys.status='assigned' — the surveyor then keeps seeing "Waiting for
    // Payment..." even after a fresh app launch. Calling verifyPayment here
    // guarantees the DB is moved to completed/in_transit. It's idempotent
    // server-side, so this is safe even when the server callback also fires.
    //
    // We also navigate immediately rather than parking on an Alert — the WebView
    // would otherwise sit on the SabPaisa redirect page (often the web frontend's
    // /login, which is what the user reported seeing).
    const handlePaymentSuccess = useCallback(async (paymentIdFromCallback, surveyIdFromCallback) => {
        const finalSurveyId = surveyIdFromCallback || survey_id;
        const finalPaymentId = paymentIdFromCallback || payment_id;

        const navigateBack = () => {
            if (finalSurveyId) {
                if (router.canGoBack()) {
                    router.back();
                } else {
                    router.replace(`/survey-detail/${finalSurveyId}`);
                }
            } else {
                router.back();
            }
        };

        if (finalSurveyId && finalPaymentId) {
            try {
                await verifyPayment(finalSurveyId, {
                    payment_id: Number(finalPaymentId),
                    gateway_transaction_id: null,
                    gateway_order_id: null,
                    gateway_response: { source: 'mobile_webview_callback' }
                });
            } catch (err) {
                console.error('verifyPayment failed:', err?.message || err);
            }
        }

        navigateBack();

        // Toast-like confirmation. Non-blocking so the survey screen is visible
        // underneath when the user dismisses it.
        setTimeout(() => {
            Alert.alert(
                '✅ Payment Successful',
                'Your payment has been processed. The surveyor has been notified.'
            );
        }, 300);
    }, [router, survey_id, payment_id]);

    // Handle failed payment
    const handlePaymentFailure = useCallback((message) => {
        Alert.alert(
            '❌ Payment Failed',
            message || 'Your payment could not be processed. Please try again.',
            [
                {
                    text: 'Go Back',
                    onPress: () => router.back()
                },
                {
                    text: 'Retry',
                    onPress: () => webViewRef.current?.reload()
                }
            ]
        );
    }, [router]);

    // Handle WebView error
    const handleError = useCallback((syntheticEvent) => {
        const { nativeEvent } = syntheticEvent;
        console.error('WebView error:', nativeEvent);
        // Ignore NSURLErrorDomain error -1002 (unsupported URL) and Android ERR_UNKNOWN_URL_SCHEME (-10)
        if ((nativeEvent.code === -1002 || nativeEvent.code === -10) && nativeEvent.url?.startsWith('claimsmitra://')) {
            return;
        }
        setError(nativeEvent.description || 'Failed to load payment page');
        setLoading(false);
    }, []);

    // Handle cancel payment
    const handleCancel = useCallback(() => {
        Alert.alert(
            'Cancel Payment',
            'Are you sure you want to cancel this payment?',
            [
                { text: 'No, Continue', style: 'cancel' },
                {
                    text: 'Yes, Cancel',
                    style: 'destructive',
                    onPress: () => router.back()
                }
            ]
        );
    }, [router]);

    // Show error state
    if (error) {
        return (
            <View style={[styles.container, styles.centered]}>
                <MaterialIcons name="error-outline" size={64} color="#FF3B30" />
                <Text style={styles.errorTitle}>Unable to Load Payment</Text>
                <Text style={styles.errorMessage}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => {
                    setError(null);
                    setLoading(true);
                    webViewRef.current?.reload();
                }}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Text style={styles.backBtnText}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // Show validation error if params missing
    if (!payment_url && !paymentHtml) {
        return (
            <View style={[styles.container, styles.centered]}>
                <MaterialIcons name="error-outline" size={64} color="#FF9500" />
                <Text style={styles.errorTitle}>Invalid Payment Configuration</Text>
                <Text style={styles.errorMessage}>Payment parameters are missing. Please try again.</Text>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Text style={styles.backBtnText}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={styles.headerBtn} onPress={handleCancel}>
                    <MaterialIcons name="close" size={24} color="#333" />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle}>Complete Payment</Text>
                    {amount && (
                        <Text style={styles.headerAmount}>₹{parseFloat(amount).toLocaleString('en-IN')}</Text>
                    )}
                </View>
                <View style={styles.headerBtn}>
                    <MaterialIcons name="lock" size={20} color="#4CAF50" />
                </View>
            </View>

            {/* Security Banner */}
            <View style={styles.securityBanner}>
                <MaterialIcons name="verified-user" size={16} color="#4CAF50" />
                <Text style={styles.securityText}>Secure payment powered by SabPaisa</Text>
            </View>

            {/* WebView */}
            <View style={styles.webViewContainer}>
                <WebView
                    ref={webViewRef}
                    source={paymentHtml ? { html: paymentHtml, baseUrl: spURL } : { uri: payment_url }}
                    style={styles.webView}
                    onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
                    onNavigationStateChange={handleNavigationStateChange}
                    onError={handleError}
                    onHttpError={(syntheticEvent) => {
                        const { nativeEvent } = syntheticEvent;
                        if (nativeEvent.statusCode >= 400) {
                            setError(`HTTP Error: ${nativeEvent.statusCode}`);
                        }
                    }}
                    startInLoadingState={true}
                    renderLoading={() => (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color={AppColors.primary} />
                            <Text style={styles.loadingText}>Loading payment page...</Text>
                        </View>
                    )}
                    javaScriptEnabled={true}
                    domStorageEnabled={true}
                    thirdPartyCookiesEnabled={true}
                    sharedCookiesEnabled={true}
                    originWhitelist={['*', 'claimsmitra://*']}
                    mixedContentMode="compatibility"
                    allowsInlineMediaPlayback={true}
                    mediaPlaybackRequiresUserAction={false}
                    scalesPageToFit={true}
                    userAgent={Platform.select({
                        ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1 ClaimsMitraApp',
                        android: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36 ClaimsMitraApp'
                    })}
                />
            </View>

            {/* Loading Overlay (only for initial load) */}
            {loading && !paymentHtml && (
                <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="small" color={AppColors.primary} />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFF',
    },
    centered: {
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    headerBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F5F5F5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerCenter: {
        flex: 1,
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    headerAmount: {
        fontSize: 14,
        fontWeight: '700',
        color: AppColors.primary,
        marginTop: 2,
    },
    securityBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#E8F5E9',
        paddingVertical: 8,
        gap: 6,
    },
    securityText: {
        fontSize: 12,
        color: '#2E7D32',
        fontWeight: '500',
    },
    webViewContainer: {
        flex: 1,
    },
    webView: {
        flex: 1,
    },
    loadingContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#FFF',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
        color: '#666',
    },
    loadingOverlay: {
        position: 'absolute',
        top: 100,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    errorTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginTop: 16,
    },
    errorMessage: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 20,
    },
    retryBtn: {
        marginTop: 24,
        backgroundColor: AppColors.primary,
        paddingHorizontal: 32,
        paddingVertical: 12,
        borderRadius: 8,
    },
    retryBtnText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
    backBtn: {
        marginTop: 12,
        paddingHorizontal: 32,
        paddingVertical: 12,
    },
    backBtnText: {
        color: '#666',
        fontSize: 14,
        fontWeight: '500',
    },
});
