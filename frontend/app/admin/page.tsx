'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function AdminDashboard() {
  const [surveys, setSurveys] = useState<any[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchSurveys();
  }, []);

  const fetchSurveys = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/surveys`);
      setSurveys(res.data);
    } catch (err) {
      console.error("Failed to fetch surveys", err);
    }
  };

  const createSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle) return;
    try {
      const res = await axios.post(`${API_URL}/api/surveys`, { title: newTitle });
      router.push(`/admin/survey/${res.data.id}`);
    } catch (err) {
      console.error("Failed to create survey", err);
    }
  };

  const togglePublish = async (id: number, isCurrentlyActive: boolean) => {
    try {
      if (isCurrentlyActive) {
        await axios.post(`${API_URL}/api/surveys/${id}/unpublish`);
      } else {
        await axios.post(`${API_URL}/api/surveys/${id}/publish`);
      }
      fetchSurveys();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Action failed. Make sure the survey has exactly 5 questions before publishing.");
    }
  };

  const deleteSurvey = async (id: number, isCurrentlyActive: boolean) => {
    if (isCurrentlyActive) {
      alert("You must unpublish this survey before you can delete it.");
      return;
    }
    
    if (confirm("Are you sure you want to permanently delete this survey?")) {
      try {
        await axios.delete(`${API_URL}/api/surveys/${id}`);
        fetchSurveys();
      } catch (err) {
        console.error("Failed to delete", err);
        alert("Failed to delete survey.");
      }
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Admin Portal</h1>
        
        {/* Creation Section */}
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-semibold mb-4">Start a New Survey</h2>
          <form onSubmit={createSurvey} className="flex gap-4">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Enter survey title..."
              className="flex-1 border p-3 rounded outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <button type="submit" className="bg-blue-600 text-white px-6 py-3 rounded hover:bg-blue-700 font-medium">
              Create & Edit Questions
            </button>
          </form>
        </div>

        {/* Survey List Section */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">All Surveys</h2>
          {surveys.length === 0 ? (
            <p className="text-gray-500 italic">No surveys created yet.</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {surveys.map((survey) => (
                <li key={survey.id} className="py-5 flex flex-col md:flex-row justify-between md:items-center gap-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-gray-900">{survey.title}</h3>
                    <div className="flex items-center gap-3 mt-2">
                      <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${survey.is_active ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                        {survey.is_active ? 'Published' : 'Draft'}
                      </span>
                      {survey.is_active ? (
                        <span className="text-sm text-gray-600">
                          <a href={`${window.location.origin}/survey/${survey.id}`} target="_blank" className="text-blue-600 hover:underline">
                            {window.location.origin}/survey/{survey.id}
                          </a>
                        </span>
                      ) : (
                        <span className="text-sm text-gray-500 italic">Needs 5 questions to publish</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button 
                      onClick={() => togglePublish(survey.id, survey.is_active)}
                      className={`text-sm px-4 py-2 font-medium border rounded transition ${
                        survey.is_active 
                          ? 'border-red-200 text-red-600 hover:bg-red-50' 
                          : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      {survey.is_active ? 'Unpublish' : 'Publish'}
                    </button>

                    <Link 
                      href={`/admin/survey/${survey.id}/responses`} 
                      className="text-sm px-4 py-2 bg-green-100 text-green-800 rounded hover:bg-green-200 font-medium transition"
                    >
                      Responses
                    </Link>

                    <Link 
                      href={`/admin/survey/${survey.id}`} 
                      className="text-sm px-4 py-2 bg-gray-100 text-gray-800 rounded hover:bg-gray-200 font-medium transition"
                    >
                      Manage
                    </Link>

                    <button 
                      onClick={() => deleteSurvey(survey.id, survey.is_active)}
                      className="text-sm px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 font-medium transition"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
