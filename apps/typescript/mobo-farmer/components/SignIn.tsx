"use client";

import { useState } from "react";
import { signInWithEmailAndPassword, signInWithPopup, createUserWithEmailAndPassword } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase/config";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
        try {
          await createUserWithEmailAndPassword(auth, email, password);
        } catch (createErr: any) {
          setError(createErr.message);
        }
      } else {
        setError(err.message);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 max-w-md mx-auto space-y-4 border rounded shadow-md mt-10">
      <h2 className="text-xl font-bold">Sign In to MoboFarmer</h2>
      
      <form onSubmit={handleEmailSignIn} className="w-full flex flex-col space-y-3">
        <input 
          type="email" 
          placeholder="Email" 
          className="border p-2 rounded"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input 
          type="password" 
          placeholder="Password" 
          className="border p-2 rounded"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700">
          Sign In / Register with Email
        </button>
      </form>

      <div className="text-gray-500">OR</div>

      <button 
        onClick={handleGoogleSignIn}
        className="w-full bg-red-600 text-white p-2 rounded hover:bg-red-700"
      >
        Sign In with Google
      </button>

      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  );
}
