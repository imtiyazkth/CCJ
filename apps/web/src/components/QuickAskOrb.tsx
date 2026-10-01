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
          shadow-lg shadow-black/20 overflow-hidden border border-white/40"
        style={{
          background: `
            radial-gradient(circle at 30% 35%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 18%),
            radial-gradient(circle at 25% 45%, #ff3b7f 0%, transparent 55%),
            radial-gradient(circle at 70% 60%, #3b8bff 0%, transparent 55%),
            radial-gradient(circle at 55% 25%, #22e0b0 0%, transparent 60%),
            #0b1220
          `,
        }}
      >
        <span className="sr-only">Ask CCJ</span>
      </button>
      {open && <QuickAskModal onClose={() => setOpen(false)} />}
    </>
  );
}
