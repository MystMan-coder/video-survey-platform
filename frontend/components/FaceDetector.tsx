'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe / TF noise reduction that doesn't break the WASM internal stdout
if (typeof window !== 'undefined') {
  const filterStrings = ['XNNPACK', 'TensorFlow', 'MediaPipe', 'wasm', 'tensorflow'];
  const wrap = (orig: any) => (...args: any[]) => {
    try {
      const msg = args.map(a => String(a)).join(' ');
      if (filterStrings.some(s => msg.includes(s))) return;
    } catch (e) {}
    return orig.apply(console, args);
  };
  console.info = wrap(console.info);
  console.warn = wrap(console.warn);
  // We leave console.error alone to avoid hiding real crashes
}

interface FaceDetectionResult {
  faceDetected: boolean;
  faceCount: number;
  score: number;
  error: string | null;
  isStable: boolean;
}

export function useFaceDetection(videoElement: HTMLVideoElement | null) {
  const [result, setResult] = useState<FaceDetectionResult>({
    faceDetected: false, faceCount: 0, score: 0, error: null, isStable: false,
  });

  const [isLoading, setIsLoading] = useState(true);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const animationFrameRef = useRef<number>();
  const lastVideoTimeRef = useRef(-1);
  const stableCountRef = useRef(0);
  const REQUIRED_STABLE_FRAMES = 5;

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
          outputFaceBlendshapes: false, 
          outputFacialTransformationMatrixes: false,
          runningMode: 'VIDEO',
          numFaces: 5,
        });
        faceLandmarkerRef.current = faceLandmarker;
        setIsLoading(false);
      } catch (err) {
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
    // guard: skip frame if video isn't ready or dimensions are zero (avoids ROI crash in MediaPipe)
    if (
      !videoElement || 
      !faceLandmarkerRef.current || 
      videoElement.readyState < 2 || 
      videoElement.videoWidth === 0 || 
      videoElement.videoHeight === 0
    ) {
      animationFrameRef.current = requestAnimationFrame(detectFaces);
      return;
    }

    if (videoElement.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = videoElement.currentTime;
      try {
        const startTimeMs = performance.now();
        const detections = faceLandmarkerRef.current.detectForVideo(videoElement, startTimeMs);
        
        if (detections && detections.faceLandmarks) {
          const faceCount = detections.faceLandmarks.length;
          let score = 0;
          let isStable = false;

          if (faceCount === 1) {
            score = 95; 
            stableCountRef.current = Math.min(stableCountRef.current + 1, REQUIRED_STABLE_FRAMES);
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
        }
      } catch (err) {
        // Silent catch for remaining intermittent frames
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