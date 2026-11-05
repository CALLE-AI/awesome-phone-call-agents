import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.js';
import { VerificationTask } from '../types/index.js';

export function useCallStatus(
  activeTaskId: string | null,
  activeCallId: string | null,
  onTaskUpdated: (task: VerificationTask) => void
) {
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!activeCallId && !activeTaskId) {
      setIsPolling(false);
      return;
    }

    let isMounted = true;
    setIsPolling(true);
    setError(null);

    const poll = async () => {
      try {
        const targetId = activeCallId || `call_${activeTaskId}`;
        const res = await api.getCallProgress(targetId, activeTaskId || undefined);

        if (isMounted && res.task) {
          onTaskUpdated(res.task);

          // Stop polling if terminal state is reached
          if (
            res.task.callState === 'COMPLETED' ||
            res.task.callState === 'FAILED' ||
            res.task.callState === 'CANCELED'
          ) {
            setIsPolling(false);
            return;
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Polling error');
        }
      }

      if (isMounted) {
        timerRef.current = setTimeout(poll, 1500);
      }
    };

    poll();

    return () => {
      isMounted = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [activeCallId, activeTaskId]);

  return { isPolling, error };
}
