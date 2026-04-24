'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (pathname === '/admin/login') {
      setIsAuthenticated(true);
      return;
    }

    const authFlag = localStorage.getItem('isAdminAuthenticated');
    const authTime = localStorage.getItem('adminAuthTime');
    
    // Check if logged in AND less than 1 hour has passed (3600000 ms)
    const isSessionValid = authTime && (Date.now() - parseInt(authTime) < 3600000);

    if (authFlag === 'true' && isSessionValid) {
      setIsAuthenticated(true);
    } else {
      handleLogout();
    }
  }, [pathname, router]);

  const handleLogout = () => {
    localStorage.removeItem('isAdminAuthenticated');
    localStorage.removeItem('adminAuthTime');
    router.push('/admin/login');
  };

  if (!isAuthenticated) return null; 

  return (
    <div className="min-h-screen bg-gray-50">
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