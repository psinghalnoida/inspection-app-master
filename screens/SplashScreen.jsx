import { Video, ResizeMode } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { AppColors } from '../constants/theme';

const { width, height } = Dimensions.get('window');

export default function SplashScreen() {
    const router = useRouter();
    const videoRef = useRef(null);
    const [isVideoFinished, setIsVideoFinished] = useState(false);

    useEffect(() => {
        // Fallback: Navigate after 5 seconds if video doesn't finish
        const timeout = setTimeout(() => {
            if (!isVideoFinished) {
                handleVideoEnd();
            }
        }, 5000);

        return () => clearTimeout(timeout);
    }, [isVideoFinished]);

    const handleVideoEnd = () => {
        setIsVideoFinished(true);
        router.replace('/login');
    };

    const handlePlaybackStatusUpdate = (status) => {
        if (status.didJustFinish && !isVideoFinished) {
            handleVideoEnd();
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.videoContainer}>
                <Video
                    ref={videoRef}
                    source={require('../assets/videos/splash-video.mp4')}
                    style={styles.video}
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay
                    isLooping={false}
                    isMuted={true}
                    onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
    },
    videoContainer: {
        width: width,
        height: width,
        justifyContent: 'center',
        alignItems: 'center',
    },
    video: {
        width: '100%',
        height: '100%',
    },
});
