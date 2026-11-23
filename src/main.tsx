import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/theme.css'
import { App } from './App.tsx'
import { bootstrapPlatform } from './platform.ts'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

// Awaited before the first render on purpose: the store starts a feed refresh
// as soon as it mounts, and on desktop that request has to go through the
// native fetcher or it meets the CORS wall the wrapper exists to avoid.
const platform = await bootstrapPlatform()
document.documentElement.dataset.platform = platform

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
