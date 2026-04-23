// frontend/lib/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
});

// Survey types
export interface Survey {
  id: number;
  title: string;
  is_active: boolean;
  created_at: string;
  questions: SurveyQuestion[];
}

export interface SurveyQuestion {
  id: number;
  survey_id: number;
  question_text: string;
  order: number;
}

export interface SubmissionStart {
  submission_id: number;
  survey_id: number;
  started_at: string;
}

export interface AnswerSubmit {
  question_id: number;
  answer: 'Yes' | 'No';
  face_detected: boolean;
  face_score: number;
}

export interface AnswerResponse {
  id: number;
  submission_id: number;
  question_id: number;
  answer: string;
  face_detected: boolean;
  face_score: number | null;
  face_image_path: string | null;
}

// API functions
export const getSurvey = async (surveyId: string): Promise<Survey> => {
  const res = await api.get(`/api/surveys/${surveyId}`);
  return res.data;
};

export const startSubmission = async (surveyId: string): Promise<SubmissionStart> => {
  const res = await api.post(`/api/surveys/${surveyId}/start`);
  return res.data;
};

export const submitAnswer = async (
  submissionId: number,
  data: AnswerSubmit
): Promise<AnswerResponse> => {
  const res = await api.post(`/api/submissions/${submissionId}/answers`, data);
  return res.data;
};

export const uploadMedia = async (
  submissionId: number,
  file: File,
  mediaType: 'video' | 'image',
  answerId?: number
): Promise<any> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('media_type', mediaType);
  if (answerId !== undefined) {
    formData.append('answer_id', answerId.toString());
  }
  const res = await api.post(`/api/submissions/${submissionId}/media`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

export const completeSubmission = async (submissionId: number): Promise<any> => {
  const res = await api.post(`/api/submissions/${submissionId}/complete`);
  return res.data;
};