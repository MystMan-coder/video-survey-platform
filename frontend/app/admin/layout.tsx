'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (pathname === '/admin/login') {
      setIsAuthenticated(true); // Let them render the login page
      return;
    }

    const authFlag = localStorage.getItem('isAdminAuthenticated');
    const authTime = localStorage.getItem('adminAuthTime');

    //Login time set to 1 hour
    const isSessionValid = authTime && (Date.now() - parseInt(authTime) < 3600000);

    if (authFlag === 'true' && isSessionValid) {
      setIsAuthenticated(true);
    } else {
      // Not authenticated, kick them back to login
      router.push('/admin/login');
    }
  }, [pathname, router]);

  const handleLogout = () => {
    localStorage.removeItem('isAdminAuthenticated');
    router.push('/admin/login');
  };

  // Prevent flashing of admin content before redirect
  if (!isAuthenticated) return null; 

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Show a simple admin navbar if not on the login page */}
      {pathname !== '/admin/login' && (
        <nav className="bg-gray-800 text-white p-4 flex justify-between items-center">
          <div className="font-bold text-lg">Survey Platform Admin</div>
          <button 
            onClick={handleLogout}
            className="text-sm bg-gray-700 px-3 py-1 rounded hover:bg-gray-600"
          >
            Logout
          </button>
        </nav>
      )}
      {children}
    </div>
  );
}