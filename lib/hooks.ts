"use client";

import { useState, useEffect } from "react";
import { getTimeRemaining } from "@/lib/constants";

export function useCountdown(deadline: number) {
  const [state, setState] = useState(() => getTimeRemaining(deadline));

  useEffect(() => {
    const interval = setInterval(() => {
      setState(getTimeRemaining(deadline));
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return state;
}
