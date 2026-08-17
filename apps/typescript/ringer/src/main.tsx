import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './index.css'
import App from './App.tsx'
import { SmoothScroll } from '@/components/motion/SmoothScroll'
import { ClickSpark } from '@/components/bits/ClickSpark'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SmoothScroll>
      <MotionConfig reducedMotion="user">
        <ClickSpark>
          <App />
        </ClickSpark>
      </MotionConfig>
    </SmoothScroll>
  </StrictMode>,
)
