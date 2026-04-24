'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import { getSurvey, startSubmission, submitAnswer, uploadMedia, completeSubmission } from '@/lib/api';
import { useFaceDetection } from '@/components/FaceDetector';

type Step = 'loading' | 'permission' | 'question' | 'uploading' | 'complete';

export default function SurveyPage() {
  const params = useParams();
  const surveyId = params.surveyId as string;

  const [step, setStep] = useState<Step>('loading');
  const [survey, setSurvey] = useState<any>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorReady, setDetectorReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>('Preparing...');
  const [finalizeStarted, setFinalizeStarted] = useState(false);

  // Use refs for MediaRecorder and chunks to avoid stale closure / timing issues
  const isSubmittingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const webcamRef = useRef<Webcam>(null);

  // Derive video element for face detection
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const { result: faceResult, isLoading: faceLoading, getSnapshotBlob } = useFaceDetection(videoEl);

  useEffect(() => {
    if (!faceLoading) setDetectorReady(true);
  }, [faceLoading]);

  useEffect(() => {
    getSurvey(surveyId)
      .then(data => {
        data.questions.sort((a: any, b: any) => Number(a.order) - Number(b.order));
        setSurvey(data);
        setStep('permission');
      })
      .catch(() => setCameraError('Failed to load survey. Please refresh.'));
  }, [surveyId]);

  const handleUserMedia = useCallback(async () => {
    // Update videoEl ref for face detection
    if (webcamRef.current?.video) {
      setVideoEl(webcamRef.current.video);
    }

    if (!survey) return;

    try {
      const start = await startSubmission(surveyId);
      setSubmissionId(start.submission_id);

      // Start recording from the live stream with 1-second timeslice
      // so data is flushed regularly and not lost if stream dies
      const stream = webcamRef.current?.stream;
      if (stream) {
        recordedChunksRef.current = [];
        const recorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp8',
          videoBitsPerSecond: 200000, // 200 kbps — keeps file small (~8MB for 5 mins)
        });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };
        recorder.start(1000); // timesliced: collect data every 1s
        mediaRecorderRef.current = recorder;
      }

      setStep('question');
    } catch (err) {
      setCameraError('Failed to start survey session. Please refresh and try again.');
    }
  }, [survey, surveyId]);

  const handleCameraError = (error: string | DOMException) => {
    setCameraError(typeof error === 'string' ? error : error.message);
  };

  const handleAnswer = async (answer: 'Yes' | 'No') => {
    if (!submissionId || !survey || !faceResult.faceDetected || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const question = survey.questions[currentQuestionIndex];
      const answerRes = await submitAnswer(submissionId, {
        question_id: question.id,
        answer,
        face_detected: faceResult.faceDetected,
        face_score: faceResult.score,
      });

      const snapshotBlob = await getSnapshotBlob();
      if (snapshotBlob) {
        const file = new File([snapshotBlob], `face_q${currentQuestionIndex + 1}.png`, { type: 'image/png' });
        await uploadMedia(submissionId, file, 'image', answerRes.id);
      }

      if (currentQuestionIndex < survey.questions.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        // Stop recorder and go to uploading
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
        setStep('uploading');
      }
    } catch (err) {
      console.error('Failed to submit answer:', err);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // session cleanup: stop recording, upload video, then mark submission complete
  useEffect(() => {
    if (step !== 'uploading' || !submissionId || finalizeStarted) return;
    setFinalizeStarted(true);

    const finalize = async () => {
      try {
        setUploadStatus('Stopping recorder...');

        // wait for the recorder to actually stop and flush its buffers
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          const stopPromise = new Promise(resolve => {
            if (!mediaRecorderRef.current) return resolve(null);
            mediaRecorderRef.current.onstop = resolve;
            mediaRecorderRef.current.stop();
          });
          await stopPromise;
        }

        setUploadStatus('Finalizing video file...');
        await new Promise(r => setTimeout(r, 1000));

        const chunks = recordedChunksRef.current;
        if (chunks.length === 0) {
          // If no chunks, we might have a recording failure, but let's try to complete anyway
          console.warn('No video chunks recorded');
        } else {
          setUploadStatus(`Uploading video (${chunks.length} chunks)...`);
          const videoBlob = new Blob(chunks, { type: 'video/webm' });
          const videoFile = new File([videoBlob], 'session.webm', { type: 'video/webm' });

          // 5-minute timeout for slow uploads
          const uploadTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Upload timed out. Check your connection or file size.')), 300000)
          );
          await Promise.race([uploadMedia(submissionId, videoFile, 'video'), uploadTimeout]);
        }

        setUploadStatus('Finishing up...');
        await completeSubmission(submissionId);
        setStep('complete');
      } catch (err: any) {
        console.error('Error finalizing submission:', err);
        setUploadError(err?.message || err?.response?.data?.detail || 'Upload failed. Please check your connection.');
        setFinalizeStarted(false); // Allow retry
      }
    };

    finalize();
  }, [step, submissionId, finalizeStarted]);

  if (cameraError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-4">
        <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
        <p className="text-center">{cameraError}</p>
      </div>
    );
  }

  if (!survey) {
    return <div className="flex items-center justify-center h-screen">Loading survey...</div>;
  }

  const currentQuestion = survey.questions[currentQuestionIndex];
  const showWebcam = step === 'permission' || step === 'question';

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">{survey.title}</h1>

        {/* SINGLE Webcam — always mounted while camera is needed, hidden via CSS when not shown */}
        <div style={{ display: showWebcam ? 'block' : 'none' }}>
          <Webcam
            ref={webcamRef}
            audio={false}
            onUserMedia={handleUserMedia}
            onUserMediaError={handleCameraError}
            videoConstraints={{ facingMode: 'user', width: 320, height: 240, frameRate: 15 }}
            className="w-full rounded-lg"
          />
        </div>

        {step === 'permission' && (
          <div className="bg-white rounded-lg shadow p-6 mt-4">
            {!detectorReady ? (
              <div className="text-center py-4">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600 mb-3"></div>
                <p className="text-gray-600">Loading face detection model... (may take a few seconds)</p>
              </div>
            ) : (
              <p className="text-gray-700">Camera access granted. Starting survey...</p>
            )}
          </div>
        )}

        {step === 'question' && currentQuestion && (
          <div className="bg-white rounded-lg shadow p-6 mt-4">
            {/* Progress */}
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
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

            {/* Face detection status */}
            <div className="mb-3">
              <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${faceResult.faceDetected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                {faceLoading ? 'Loading detector...' :
                  faceResult.faceCount === 0 ? 'No face detected' :
                    faceResult.faceCount > 1 ? 'Multiple faces detected' :
                      !faceResult.isStable ? 'Stabilizing...' :
                        `Face score: ${faceResult.score}%`}
              </span>
            </div>

            <h2 className="text-xl font-semibold mb-6">{currentQuestion.question_text}</h2>

            <div className="flex gap-4">
              <button
                onClick={() => handleAnswer('Yes')}
                disabled={!faceResult.faceDetected || !faceResult.isStable || faceLoading || isSubmitting}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-3 px-4 rounded-lg transition"
              >
                {isSubmitting ? 'Saving...' : 'Yes'}
              </button>
              <button
                onClick={() => handleAnswer('No')}
                disabled={!faceResult.faceDetected || !faceResult.isStable || faceLoading || isSubmitting}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-medium py-3 px-4 rounded-lg transition"
              >
                {isSubmitting ? 'Saving...' : 'No'}
              </button>
            </div>

            {!faceResult.faceDetected && !faceLoading && (
              <p className="mt-4 text-red-600 text-sm font-medium">
                {faceResult.faceCount === 0 ? 'Please ensure your face is visible in the camera.' :
                  faceResult.faceCount > 1 ? 'Only one person should be in the frame.' :
                    !faceResult.isStable ? 'Please hold still for a moment...' : ''}
              </p>
            )}
          </div>
        )}

        {step === 'uploading' && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            {!uploadError ? (
              <>
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-gray-300 border-t-blue-600 mb-4"></div>
                <h2 className="text-xl font-bold mb-2">Saving Video...</h2>
                <p className="text-gray-600 mb-1">{uploadStatus}</p>
                <p className="text-xs text-gray-400">Please do not close this tab.</p>
              </>
            ) : (
              <>
                <div className="text-xl font-bold text-red-600 mb-2">Error</div>
                <h2 className="text-xl font-bold text-red-600 mb-2">Upload Failed</h2>
                <p className="text-gray-600 mb-4 text-sm">{uploadError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
                >
                  Reload Page
                </button>
              </>
            )}
          </div>
        )}

        {step === 'complete' && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-2xl font-bold mb-2">Thank You!</h2>
            <p className="text-gray-600">Your responses have been securely recorded.</p>
            <p className="mt-4 text-sm text-gray-400">
              Your session video is being saved in the background.
              You may close this tab after a minute.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}