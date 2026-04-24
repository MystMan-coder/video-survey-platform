'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function SurveyResponses() {
  const params = useParams();
  const router = useRouter();
  const surveyId = params.surveyId as string;
  
  const [survey, setSurvey] = useState<any>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [surveyId]);

  const fetchData = async () => {
    try {
      const surveyRes = await axios.get(`${API_URL}/api/surveys/${surveyId}`);
      setSurvey(surveyRes.data);

      const subRes = await axios.get(`${API_URL}/api/submissions?survey_id=${surveyId}`);
      const completedSubmissions = subRes.data.filter((sub: any) => sub.completed_at !== null);
      setSubmissions(completedSubmissions);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadZip = (submissionId: number) => {
    window.open(`${API_URL}/api/submissions/${submissionId}/export`, '_blank');
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading responses...</div>;
  if (!survey) return <div className="p-8 text-center text-red-500">Survey not found.</div>;

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex gap-4 mb-6">
          <button onClick={() => router.push('/admin')} className="text-blue-600 hover:underline">
            &larr; Dashboard
          </button>
          <span className="text-gray-400">|</span>
          <button onClick={() => router.push(`/admin/survey/${surveyId}`)} className="text-blue-600 hover:underline">
            Manage Survey Questions
          </button>
        </div>

        <div className="bg-white p-8 rounded-lg shadow-md border-t-4 border-green-600">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Responses: {survey.title}</h1>
            <p className="text-gray-500 mt-1">Total Completed Submissions: {submissions.length}</p>
          </div>

          {submissions.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <p className="text-gray-500 italic">No completed responses for this survey yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-700 border-b-2 border-gray-200">
                    <th className="p-3 font-semibold text-sm">ID</th>
                    <th className="p-3 font-semibold text-sm">Date Completed</th>
                    <th className="p-3 font-semibold text-sm">Location / IP</th>
                    <th className="p-3 font-semibold text-sm">Device / OS</th>
                    <th className="p-3 font-semibold text-sm">Avg Face Score</th>
                    <th className="p-3 font-semibold text-sm text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {submissions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-gray-50 transition">
                      <td className="p-3 font-mono text-sm text-gray-600">#{sub.id}</td>
                      <td className="p-3 text-sm text-gray-800">
                        {/* FIX: Force Date parser to treat the string as UTC by appending 'Z' if missing */}
                        {new Date(sub.completed_at + (sub.completed_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}
                      </td>
                      <td className="p-3 text-sm text-gray-800">
                        {sub.location} <br />
                        <span className="text-xs text-gray-500">{sub.ip_address}</span>
                      </td>
                      <td className="p-3 text-sm text-gray-800">
                        {sub.device} <br />
                        <span className="text-xs text-gray-500">{sub.os} - {sub.browser}</span>
                      </td>
                      <td className="p-3 text-sm font-medium">
                        <span className={sub.overall_score >= 80 ? 'text-green-600' : 'text-yellow-600'}>
                          {Math.round(sub.overall_score)}%
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleDownloadZip(sub.id)}
                          className="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700 transition shadow-sm"
                        >
                          Download ZIP
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}