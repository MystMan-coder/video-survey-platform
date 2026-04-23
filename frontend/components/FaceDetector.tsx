'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

interface FaceDetectionResult {
  faceDetected: boolean;
  faceCount: number;
  score: number;
  error: string | null;
  isStable: boolean;
}

export function useFaceDetection(videoElement: HTMLVideoElement | null) {
  const [result, setResult] = useState<FaceDetectionResult>({
    faceDetected: false,
    faceCount: 0,
    score: 0,
    error: null,
    isStable: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const animationFrameRef = useRef<number>();
  const lastVideoTimeRef = useRef(-1);

  const stableCountRef = useRef(0);
  const REQUIRED_STABLE_FRAMES = 5;
  const MIN_SCORE_THRESHOLD = 30; // face must have at least 30% visibility

  useEffect(() => {
    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: 'VIDEO',
          numFaces: 5,
        });
        faceLandmarkerRef.current = faceLandmarker;
        setIsLoading(false);
      } catch (err) {
        console.error('MediaPipe init failed:', err);
        setResult(prev => ({ ...prev, error: 'Face detection failed to load' }));
        setIsLoading(false);
      }
    };
    init();

    return () => {
      faceLandmarkerRef.current?.close();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  const detectFaces = useCallback(() => {
    if (!videoElement || !faceLandmarkerRef.current || videoElement.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(detectFaces);
      return;
    }

    if (videoElement.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = videoElement.currentTime;
      try {
        const detections = faceLandmarkerRef.current.detectForVideo(videoElement, performance.now());
        const faceCount = detections.faceLandmarks.length;
        let score = 0;
        let isStable = false;

        if (faceCount === 1) {
          // Compute dynamic score from blendshapes (average of all blendshape scores)
          if (detections.faceBlendshapes.length > 0 && detections.faceBlendshapes[0].categories) {
            const scores = detections.faceBlendshapes[0].categories.map(c => c.score);
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            score = Math.round(avg * 100);
          } else {
            // Fallback: use a reasonable default if blendshapes are not available
            score = 85;
          }

          // Stability: only count frame if score is above threshold
          if (score >= MIN_SCORE_THRESHOLD) {
            stableCountRef.current = Math.min(stableCountRef.current + 1, REQUIRED_STABLE_FRAMES);
          } else {
            stableCountRef.current = 0;
          }
        } else {
          stableCountRef.current = 0;
          score = 0;
        }

        isStable = stableCountRef.current >= REQUIRED_STABLE_FRAMES;

        setResult({
          faceDetected: faceCount === 1 && isStable,
          faceCount,
          score: isStable ? score : 0,
          error: null,
          isStable,
        });
      } catch (err) {
        console.error('Detection error:', err);
        setResult(prev => ({ ...prev, error: 'Detection error', isStable: false }));
        stableCountRef.current = 0;
      }
    }
    animationFrameRef.current = requestAnimationFrame(detectFaces);
  }, [videoElement]);

  useEffect(() => {
    if (!isLoading && videoElement) {
      stableCountRef.current = 0;
      animationFrameRef.current = requestAnimationFrame(detectFaces);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isLoading, videoElement, detectFaces]);

  const captureSnapshot = useCallback((): string | null => {
    if (!videoElement) return null;
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }, [videoElement]);

  const getSnapshotBlob = useCallback(async (): Promise<Blob | null> => {
    const dataUrl = captureSnapshot();
    if (!dataUrl) return null;
    const res = await fetch(dataUrl);
    return await res.blob();
  }, [captureSnapshot]);

  return { result, isLoading, captureSnapshot, getSnapshotBlob };
}