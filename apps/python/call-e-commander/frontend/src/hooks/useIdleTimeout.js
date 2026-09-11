import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function useIdleTimeout(timeoutMs = 180000) {
  const [isIdle, setIsIdle] = useState(false);
  const timeoutRef = useRef(null);
  const navigate = useNavigate();

  const resetTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsIdle(false);
    timeoutRef.current = setTimeout(() => {
      setIsIdle(true);
      // Auto-logout for HIPAA compliance
      sessionStorage.removeItem('medops_jwt');
      navigate('/login');
    }, timeoutMs);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const events = ['mousemove', 'keydown', 'wheel', 'DOMMouseScroll', 'mouseWheel', 'mousedown', 'touchstart', 'touchmove', 'MSPointerDown', 'MSPointerMove'];
    
    events.forEach(event => {
      window.addEventListener(event, resetTimer);
    });

    resetTimer();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      events.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, []);

  return isIdle;
}
