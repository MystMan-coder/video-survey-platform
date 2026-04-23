'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function SurveyManagement() {
  const params = useParams();
  const router = useRouter();
  const surveyId = params.surveyId as string;
  
  const [survey, setSurvey] = useState<any>(null);
  const [questionText, setQuestionText] = useState('');
  
  // State for inline editing
  const [editingOrder, setEditingOrder] = useState<number | null>(null);
  const [editQuestionText, setEditQuestionText] = useState('');

  useEffect(() => {
    fetchSurveyDetails();
  }, [surveyId]);

  const fetchSurveyDetails = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/surveys/${surveyId}`);
      // Strictly sort by numeric order
      res.data.questions.sort((a: any, b: any) => Number(a.order) - Number(b.order));
      setSurvey(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  // 🎯 THE FIX: Calculate the next available slot once, ensuring it is always a strict Number
  const nextAvailableOrder = useMemo(() => {
    if (!survey || !survey.questions) return 1;
    const existingOrders = survey.questions.map((q: any) => Number(q.order));
    let next = 1;
    while (existingOrders.includes(next)) {
      next++;
    }
    return next;
  }, [survey]);

  // --- CRUD Operations ---

  const addQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!questionText || survey.questions.length >= 5) return;
    try {
      await axios.post(`${API_URL}/api/surveys/${surveyId}/questions`, {
        question_text: questionText,
        order: nextAvailableOrder // Use the robustly calculated order here
      });
      setQuestionText('');
      fetchSurveyDetails();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to add question');
    }
  };

  const startEditing = (question: any) => {
    setEditingOrder(Number(question.order));
    setEditQuestionText(question.question_text);
  };

  const saveEditedQuestion = async (order: number) => {
    if (!editQuestionText) return;
    try {
      await axios.put(`${API_URL}/api/surveys/${surveyId}/questions/${order}`, {
        question_text: editQuestionText,
        order: Number(order) 
      });
      setEditingOrder(null);
      fetchSurveyDetails();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to update question');
    }
  };

  const deleteQuestion = async (order: number) => {
    if (!confirm('Are you sure you want to delete this question?')) return;
    try {
      await axios.delete(`${API_URL}/api/surveys/${surveyId}/questions/${order}`);
      fetchSurveyDetails();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete question');
    }
  };

  const togglePublishStatus = async () => {
    try {
      if (survey.is_active) {
        await axios.post(`${API_URL}/api/surveys/${surveyId}/unpublish`);
      } else {
        await axios.post(`${API_URL}/api/surveys/${surveyId}/publish`);
      }
      fetchSurveyDetails();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Action failed');
    }
  };

  if (!survey) return <div className="p-8 text-center text-gray-500">Loading survey details...</div>;

  const publicUrl = `${window.location.origin}/survey/${surveyId}`;
  const isFull = survey.questions?.length >= 5;

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <button onClick={() => router.push('/admin')} className="text-blue-600 hover:underline mb-4 inline-block">
          &larr; Back to Dashboard
        </button>

        <div className="bg-white p-8 rounded-lg shadow-md border-t-4 border-blue-600">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{survey.title}</h1>
              <div className="mt-2 flex items-center gap-3">
                <span className={`px-3 py-1 text-sm font-semibold rounded-full ${survey.is_active ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                  {survey.is_active ? 'Published' : 'Draft'}
                </span>
                <span className="text-sm text-gray-500">{survey.questions?.length || 0} / 5 Questions</span>
              </div>
            </div>
            
            {/* Publish / Unpublish Toggle */}
            <button 
              onClick={togglePublishStatus}
              disabled={!survey.is_active && !isFull}
              className={`px-4 py-2 rounded font-medium transition ${
                survey.is_active 
                  ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' 
                  : isFull 
                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              {survey.is_active ? 'Unpublish Survey' : 'Publish Survey'}
            </button>
          </div>

          {/* Share Link Banner */}
          {survey.is_active && (
            <div className="mb-8 p-4 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-sm text-blue-800 font-medium mb-1">Share this link with participants:</p>
              <a href={publicUrl} target="_blank" rel="noreferrer" className="text-blue-600 font-mono text-sm hover:underline break-all">
                {publicUrl}
              </a>
            </div>
          )}

          <hr className="mb-6" />

          {/* Questions List */}
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Survey Questions</h2>
          
          <div className="space-y-3 mb-8">
            {survey.questions?.map((q: any) => (
              <div key={q.id} className="p-4 border rounded-lg bg-gray-50 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                
                {/* View Mode vs Edit Mode */}
                {editingOrder === Number(q.order) ? (
                  <div className="flex-1 flex gap-2">
                    <input 
                      type="text" 
                      value={editQuestionText} 
                      onChange={(e) => setEditQuestionText(e.target.value)}
                      className="flex-1 border p-2 rounded outline-none focus:border-blue-500"
                      autoFocus
                    />
                    <button onClick={() => saveEditedQuestion(q.order)} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700">Save</button>
                    <button onClick={() => setEditingOrder(null)} className="bg-gray-300 text-gray-800 px-4 py-2 rounded text-sm hover:bg-gray-400">Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 text-gray-800">
                      <span className="font-bold text-gray-500 mr-2">Q{q.order}.</span> 
                      {q.question_text}
                    </div>
                    {/* Controls (Disabled if published) */}
                    {!survey.is_active && (
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => startEditing(q)} className="text-sm text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-1 rounded">Edit</button>
                        <button onClick={() => deleteQuestion(q.order)} className="text-sm text-red-600 hover:text-red-800 bg-red-50 px-3 py-1 rounded">Delete</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            
            {survey.questions?.length === 0 && (
              <p className="text-gray-500 italic text-center py-4 border-2 border-dashed rounded-lg">No questions added yet.</p>
            )}
          </div>

          {/* Add New Question Form */}
          {!survey.is_active && !isFull && (
            <form onSubmit={addQuestion} className="flex gap-3 p-4 bg-gray-100 rounded-lg border border-gray-200">
              <span className="py-2 font-bold text-gray-500">Q{nextAvailableOrder}.</span>
              <input
                type="text"
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                placeholder="Type a Yes/No question here..."
                className="flex-1 border-gray-300 p-2 rounded outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button type="submit" className="bg-gray-800 text-white px-6 py-2 rounded font-medium hover:bg-black transition">
                Add
              </button>
            </form>
          )}

          {!survey.is_active && isFull && (
            <div className="p-4 bg-green-50 text-green-800 rounded-lg text-center font-medium border border-green-200">
              You have reached the maximum of 5 questions. You can now publish the survey!
            </div>
          )}

          {survey.is_active && (
            <div className="p-4 bg-yellow-50 text-yellow-800 rounded-lg text-sm border border-yellow-200">
              ⚠️ This survey is currently published. You must <b>Unpublish</b> it to edit, add, or delete questions.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}