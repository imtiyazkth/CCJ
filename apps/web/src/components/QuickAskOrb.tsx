"use client";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { QuickAskModal } from "./QuickAskModal";

export function QuickAskOrb() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  // Only shows once someone is signed in — not on the login/signup
  // screens, where there's no project context to escalate into yet.
  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Ask CCJ"
        // Fixed on every screen — dashboard, explore, profile, project
        // pages — regardless of what's rendered above it.
        // §1 Response: ui-pressable gives instant press feedback.
        // The layered radial-gradients + blur approximate the Siri-orb
        // look from the reference image without shipping an image asset.
        className="ui-pressable fixed bottom-6 right-5 z-40 h-14 w-14 rounded-full
          shadow-xl shadow-black/30 overflow-hidden ring-2 ring-white/60"
        style={{
          // Tighter, more saturated stops than the first pass — at 56px
          // the earlier wide-spread gradients blended into a flat, dull
          // center. Smaller/brighter blobs plus a crisp white hotspot
          // keep the "glowing orb" read at this size.
          background: `
            radial-gradient(circle at 32% 32%, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 14%),
            radial-gradient(circle at 22% 50%, #ff2f7a 0%, transparent 48%),
            radial-gradient(circle at 75% 62%, #2f8bff 0%, transparent 50%),
            radial-gradient(circle at 58% 20%, #1be8b5 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, #14102b 0%, #090714 100%)
          `,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35), 0 0 16px rgba(99,102,241,0.35)",
        }}
      >
        <span className="sr-only">Ask CCJ</span>
      </button>
      {open && <QuickAskModal onClose={() => setOpen(false)} />}
    </>
  );
}
