"use client";

import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { getDoc, doc, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

interface ProtectedRouteProps {
  allowedRole: string;
  children: React.ReactNode;
}

export default function ProtectedRoute({ allowedRole, children }: ProtectedRouteProps) {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        console.log("User UID:", user.uid);
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));

          if (userDoc.exists()) {
            const userRole = userDoc.data().role;
            console.log("User role:", userRole);
            setRole(userRole);
          } else {
            console.log("User document does not exist, setting role to proponent");
            // Create user doc with default role
            await setDoc(doc(db, "users", user.uid), { role: "proponent", email: user.email });
            setRole("proponent");
          }
        } catch (error) {
          console.error("Error fetching user role:", error);
        }
      } else {
        console.log("No user logged in");
        setRole(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <main className="container">
        <p>Loading...</p>
      </main>
    );
  }

  if (role === allowedRole) {
    return <>{children}</>;
  }

  return (
    <main className="container">
      <div className="card text-center">
        <h1 className="text-2xl font-bold text-red-600 mb-4">Access Denied</h1>
        <p>You do not have permission to access this page.</p>
      </div>
    </main>
  );
}