"use client";
import dynamic from "next/dynamic";

const MarsShield = dynamic(() => import("@/components/App"), {
  ssr: false,
  loading: () => <div className="loading">Loading Gale Crater terrain…</div>,
});

export default function Page() {
  return <MarsShield />;
}
