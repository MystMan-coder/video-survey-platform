// frontend/app/survey/[surveyId]/page.tsx
'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import { getSurvey, startSubmission, submitAnswer, uploadMedia, completeSubmission } from '@/lib/api';
import { useFaceDetection } from '@/components/FaceDetector';

type Step = 'permission' | 'question' | 'complete';

export default function SurveyPage() {
  const params = useParams();
  const surveyId = params.surveyId as string;

  const [step, setStep] = useState<Step>('permission');
  const [survey, setSurvey] = useState<any>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<{ questionId: number; answer: 'Yes' | 'No'; faceScore: number; faceDetected: boolean }[]>([]);
  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [answerIds, setAnswerIds] = useState<number[]>([]);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorReady, setDetectorReady] = useState(false);

  const webcamRef = useRef<Webcam>(null);
  const videoElement = webcamRef.current?.video || null;
  const { result: faceResult, isLoading: faceLoading, getSnapshotBlob } = useFaceDetection(videoElement);

  // Set detector ready when face detection is loaded
  useEffect(() => {
    if (!faceLoading) {
      setDetectorReady(true);
    }
  }, [faceLoading]);

  // Fetch survey
  useEffect(() => {
    getSurvey(surveyId)
      .then(data => setSurvey(data))
      .catch(err => console.error('Failed to load survey:', err));
  }, [surveyId]);

  // Start submission when survey loaded and camera ready
  const startSurveySubmission = useCallback(async () => {
    if (!survey) return;
    try {
      const start = await startSubmission(surveyId);
      setSubmissionId(start.submission_id);
      startRecording();
    } catch (err) {
      console.error('Failed to start submission:', err);
      setCameraError('Failed to start survey session');
    }
  }, [survey, surveyId]);

  // Recording logic
  const startRecording = useCallback(() => {
    if (!webcamRef.current?.stream) return;
    const recorder = new MediaRecorder(webcamRef.current.stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };
    recorder.onstop = () => {
      setRecordedChunks(chunks);
    };
    recorder.start();
    setMediaRecorder(recorder);
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  }, [mediaRecorder]);

  // Handle camera permission
  const handleUserMedia = () => {
    setStep('question');
    startSurveySubmission();
  };

  const handleCameraError = (error: string | DOMException) => {
    setCameraError(typeof error === 'string' ? error : error.message);
  };

  // Handle answer selection
  const handleAnswer = async (answer: 'Yes' | 'No') => {
    if (!submissionId || !survey || !faceResult.faceDetected) return;

    const question = survey.questions[currentQuestionIndex];
    const faceScore = faceResult.score;

    // Submit answer
    const answerRes = await submitAnswer(submissionId, {
      question_id: question.id,
      answer,
      face_detected: faceResult.faceDetected,
      face_score: faceScore,
    });
    setAnswerIds(prev => [...prev, answerRes.id]);

    // Capture and upload face snapshot
    const snapshotBlob = await getSnapshotBlob();
    if (snapshotBlob) {
      const file = new File([snapshotBlob], `face_q${currentQuestionIndex + 1}.png`, { type: 'image/png' });
      await uploadMedia(submissionId, file, 'image', answerRes.id);
    }

    setAnswers(prev => [...prev, { questionId: question.id, answer, faceScore, faceDetected: faceResult.faceDetected }]);

    // Move to next question or complete
    if (currentQuestionIndex < survey.questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      // Finish survey
      stopRecording();
      setStep('complete');
    }
  };

  // Upload video and complete submission when recording stops
  useEffect(() => {
    if (step === 'complete' && submissionId && recordedChunks.length > 0) {
      const complete = async () => {
        // Upload video
        const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
        const videoFile = new File([videoBlob], 'session.webm', { type: 'video/webm' });
        await uploadMedia(submissionId, videoFile, 'video');
        // Complete submission
        await completeSubmission(submissionId);
      };
      complete();
    }
  }, [step, submissionId, recordedChunks]);

  // Loading states
  if (!survey) {
    return <div className="flex items-center justify-center h-screen">Loading survey...</div>;
  }

  if (cameraError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-4">
        <h2 className="text-xl font-bold text-red-600 mb-4">Camera Error</h2>
        <p className="text-center">{cameraError}</p>
        <p className="mt-4">Please ensure camera permissions are granted and try again.</p>
      </div>
    );
  }

  const currentQuestion = survey.questions[currentQuestionIndex];

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">{survey.title}</h1>

        {step === 'permission' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Camera Access Required</h2>
            {!detectorReady ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600 mb-4"></div>
                <p>Loading face detection model... (may take a few seconds)</p>
              </div>
            ) : (
              <>
                <p className="mb-4">This survey requires camera access for face detection. Your video will be recorded during the session.</p>
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  onUserMedia={handleUserMedia}
                  onUserMediaError={handleCameraError}
                  className="w-full rounded-lg"
                />
              </>
            )}
          </div>
        )}

        {step === 'question' && (
  <div className="bg-white rounded-lg shadow p-6">
    {/* Progress */}
    <div className="mb-4">
      <div className="flex justify-between text-sm text-gray-800 mb-1">
        <span>Question {currentQuestionIndex + 1} of {survey.questions.length}</span>
        <span>{Math.round(((currentQuestionIndex + 1) / survey.questions.length) * 100)}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all"
          style={{ width: `${((currentQuestionIndex + 1) / survey.questions.length) * 100}%` }}
        />
      </div>
    </div>

    {/* Camera preview */}
    <div className="relative mb-4">
      <Webcam
        ref={webcamRef}
        audio={false}
        className="w-full rounded-lg"
        videoConstraints={{ facingMode: 'user' }}
      />
      <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-3 py-1 rounded-full text-sm">
        {faceLoading ? 'Loading detector...' : faceResult.error ? 'Error' : 
          faceResult.faceCount === 0 ? 'No face detected' :
          faceResult.faceCount > 1 ? 'Multiple faces detected' :
          !faceResult.isStable ? 'Stabilizing...' :
          `Face score: ${faceResult.score}%`}
      </div>
    </div>

    {/* Question */}
    <h2 className="text-xl font-semibold mb-6">{currentQuestion.question_text}</h2>

    {/* Yes/No buttons */}
    <div className="flex gap-4">
      <button
        onClick={() => handleAnswer('Yes')}
        disabled={!faceResult.faceDetected || !faceResult.isStable || faceLoading}
        className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-3 px-4 rounded-lg transition"
      >
        Yes
      </button>
      <button
        onClick={() => handleAnswer('No')}
        disabled={!faceResult.faceDetected || !faceResult.isStable || faceLoading}
        className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-medium py-3 px-4 rounded-lg transition"
      >
        No
      </button>
    </div>

    {/* Error messages for face detection */}
    {!faceResult.faceDetected && !faceLoading && (
      <p className="mt-4 text-red-600 text-sm">
        {faceResult.faceCount === 0 ? 'Please ensure your face is visible in the camera.' :
         faceResult.faceCount > 1 ? 'Only one person should be in the frame.' :
         !faceResult.isStable ? 'Please hold still for a moment...' : ''}
      </p>
    )}
  </div>
)}

        {step === 'complete' && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-2xl font-bold mb-2">Thank You!</h2>
            <p className="text-gray-600">Your responses have been recorded.</p>
          </div>
        )}
      </div>
    </main>
  );
}