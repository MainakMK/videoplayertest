"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Team was merged into Settings > Team tab. Preserve the URL by redirecting.
 */
export default function TeamRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings?tab=Team");
  }, [router]);
  return null;
}
