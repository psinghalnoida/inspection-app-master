import { useLocalSearchParams } from 'expo-router';
import SurveyorInspectionScreen from '../../screens/surveyor/SurveyorInspectionScreen';

export default function SurveyorExecutionPage() {
    const { id } = useLocalSearchParams();
    return <SurveyorInspectionScreen surveyId={id} />;
}
