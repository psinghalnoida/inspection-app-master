import { Stack } from 'expo-router';
import SurveyorSelfTrackingScreen from '../../screens/SurveyorSelfTrackingScreen';

export default function SelfTrackingRoute() {
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <SurveyorSelfTrackingScreen />
        </>
    );
}
